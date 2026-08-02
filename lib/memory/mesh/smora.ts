/**
 * S-MORA retrieval subsystem (RFC-0012) — extracted from the MemoryMesh
 * god-class (workspace-cg2). 5-layer pipeline: scrubbing → HyDE-Lite →
 * multi-channel retrieval → RRF → heritage-aware reranking, plus the intent
 * embedding cache and HyDE generation helpers. Functions take the mesh facade
 * as their first argument; MemoryMesh delegates 1:1.
 */
import { createLogger } from "../../utils/logger.js";
import { DECAY_BY_TYPE, DEFAULT_DECAY } from "./shared.js";
import { rrfMerge } from "./rrf.js";
import type { MemoryMesh } from "../memory-mesh.js";

const logger = createLogger("brain");

/**
 * S-MORA: Singularity Memory-Oriented Retrieval Augmentation (RFC-0012)
 * 5-layer pipeline: Scrubbing → HyDE-Lite → Multi-channel retrieval → RRF → Heritage-aware reranking
 */
export async function smora(mesh: MemoryMesh, query: string, options: {
    limit?: number;
    retrievalLimit?: number;
    sessionIntent?: string[];
    enableSynthesis?: boolean;
    enableHyDE?: boolean;
    useCache?: boolean;
} = {}): Promise<{
    results: Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
        score: number;
        semanticScore: number;
        heritageBonus: number;
        recencyDecay: number;
        rrfRank: number;
    }>;
    synthesis?: string;
    pipeline: {
        queryExpanded: boolean;
        heritageAware: boolean;
        synthesized: boolean;
        latencyMs: number;
    };
}> {
    await mesh.init();
    const t0 = Date.now();
    const {
        limit = 10,
        retrievalLimit = 30,
        sessionIntent = [],
        enableSynthesis = false,
        enableHyDE = true,
    } = options;

    // Layer 0: scrub query. Mirror add()'s pattern — scrubber.process() returns
    // { chunks, metadata, telemetry, success }, not a `content` field, so derive
    // the cleaned text by joining chunk texts. Falls back to the raw query when
    // scrubbing fails or yields no chunks.
    let scrubbed = query;
    try {
        if (mesh.scrubber) {
            const s = await mesh.scrubber.process({ content: query });
            if (s.success && s.chunks.length > 0) {
                scrubbed = s.chunks.map((c: any) => c.text).join("\n\n");
            }
        }
    } catch { /* non-fatal */ }

    if (!mesh.client) {
        return { results: [], pipeline: { queryExpanded: false, heritageAware: false, synthesized: false, latencyMs: Date.now() - t0 } };
    }

    // Layer 1: HyDE — LLM-generated hypothetical answer (template fallback)
    let hydeQuery: string | null = null;
    if (enableHyDE) {
        hydeQuery = await mesh._generateHyDE(scrubbed);
    }

    // Layer 2: Multi-channel retrieval (semantic original, semantic HyDE, keyword BM25)
    // HyDE expansion already reads like a document, so embed it as a passage
    // rather than a query — the prefix difference matters for instruction-aware models.
    const queryVec = await mesh.embeddingFactory.embed(scrubbed, { isQuery: true });
    const hydeVec = hydeQuery ? await mesh.embeddingFactory.embed(hydeQuery, { isQuery: false }) : null;

    const [semanticOrig, semanticHyde, keywordResults] = await Promise.all([
        mesh.client.search(queryVec, { limit: retrievalLimit, filter: 'superseded_at IS NULL' }),
        hydeVec ? mesh.client.search(hydeVec, { limit: retrievalLimit, filter: 'superseded_at IS NULL' }) : Promise.resolve([]),
        Promise.resolve(mesh.keywordSearch.search(scrubbed, { limit: retrievalLimit })),
    ]);

    // Layer 3: Reciprocal Rank Fusion (k=60, channel weights: 1.0 / 0.8 / 0.6)
    // Shared implementation — see mesh/rrf.ts.
    const fusedEntries = rrfMerge<any>([
        { items: semanticOrig, weight: 1.0 },
        { items: semanticHyde, weight: 0.8 },
        {
            items: keywordResults.map((r: any) => ({ id: r.id, content: r.content, metadata: r.metadata, created_at: r.created_at || new Date().toISOString() })),
            weight: 0.6,
        },
    ]);
    const rrfScores = new Map(fusedEntries.map((e) => [e.id, e.rrfScore]));

    // Take top pre_rerank_limit candidates
    const preRerankLimit = 20;
    let candidates = fusedEntries
        .slice(0, preRerankLimit)
        .map((e) => e.doc)
        .filter(Boolean);

    // Optional Layer 2.5: ColBERT late-interaction rerank
    // Runs token-level MaxSim over the candidate set before the cross-encoder.
    // Catches token-level alignment that pooled vectors flatten away — useful
    // on long-doc / multi-topic candidates. No-op when the model can't produce
    // token embeddings; cost is amortized across the candidate set (top 20).
    const enableColbert = (options as any).enableColbert === true;
    if (enableColbert && candidates.length > 0) {
        try {
            const reranked = await mesh.embeddingFactory.colbertRerank(scrubbed, candidates);
            if (Array.isArray(reranked) && reranked.length === candidates.length) {
                candidates = reranked;
            }
        } catch (error) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.warn({ err: error }, "ColBERT rerank in smora failed, falling back to RRF order");
            }
        }
    }

    // Compute cross-encoder scores if enabled
    let ceScores = null;
    if (mesh.enableReranker && candidates.length > 0) {
        try {
            const docContents = candidates.map((d) => d.content);
            ceScores = await mesh.embeddingFactory.rerank(scrubbed, docContents);
        } catch (error) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.warn({ err: error }, "Cross-encoder reranking in smora failed, falling back to RRF scores");
            }
        }
    }

    // Layer 4: Heritage-aware reranking
    // final_score = 0.6×semantic_sim + 0.25×heritage_bonus + 0.15×recency_decay
    // When no sessionIntent: weights renormalize → α=0.71, γ=0.29
    const hasHeritage = sessionIntent.length > 0;
    const α = hasHeritage ? 0.6 : 0.71;
    const β = hasHeritage ? 0.25 : 0.0;
    const γ = hasHeritage ? 0.15 : 0.29;
    const now = Date.now();

    // Pre-embed pass for heritage rerank (workspace-bb4): collect every
    // unique intent that the doc loop will need (session + each doc's
    // intentChain), embed in one parallel batch (cache-aware), look up
    // synchronously inside the per-doc loop. Lets us catch synonymy
    // (e.g. "debug" ≈ "troubleshoot") without async-ifying the rerank
    // loop. Falls back to raw token overlap if embedding is unavailable.
    const intentVecMap: Map<string, number[]> = new Map();
    if (hasHeritage) {
        const allIntents = new Set<string>();
        for (const si of sessionIntent) {
            const k = mesh._canonicalizeIntent(si);
            if (k) allIntents.add(k);
        }
        for (const doc of candidates) {
            try {
                const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
                const chain = meta?.heritage_chain;
                const parsedChain = typeof chain === 'string' ? JSON.parse(chain) : chain;
                const intents: string[] = parsedChain?.intentChain ?? [];
                for (const i of intents) {
                    const k = mesh._canonicalizeIntent(i);
                    if (k) allIntents.add(k);
                }
            } catch { /* skip docs with no heritage */ }
        }
        if (allIntents.size > 0) {
            try {
                const intentArr = Array.from(allIntents);
                const vecs = await Promise.all(intentArr.map((i) => mesh._embedIntent(i)));
                for (let i = 0; i < intentArr.length; i++) {
                    if (vecs[i]) intentVecMap.set(intentArr[i], vecs[i]!);
                }
            } catch (e) {
                if (process.env.YAMO_DEBUG === 'true') {
                    logger.debug({ err: e }, 'Intent pre-embed failed, heritage will use raw overlap');
                }
            }
        }
    }

    const reranked = candidates.map((doc: any, idx: number) => {
        // Semantic score: use cross-encoder if available, otherwise RRF-based approximation
        let semanticScore = 0;
        if (ceScores && ceScores[idx] !== undefined) {
            const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
            semanticScore = sigmoid(ceScores[idx]);
        } else {
            const rrfScore = rrfScores.get(doc.id) || 0;
            semanticScore = Math.min(1.0, rrfScore * 20); // scale to ~[0,1]
        }

        // Heritage bonus: max(raw exact-match, embedded MaxSim) so
        // embedded synonymy augments rather than replaces exact matches.
        let heritageBonus = 0;
        if (hasHeritage) {
            try {
                const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
                const chain = meta?.heritage_chain;
                const parsedChain = typeof chain === 'string' ? JSON.parse(chain) : chain;
                const intentChain: string[] = parsedChain?.intentChain ?? [];
                if (intentChain.length > 0) {
                    const denom = sessionIntent.length;
                    const rawOverlap = intentChain.filter((i: string) => sessionIntent.includes(i)).length;
                    const rawBonus = denom > 0 ? Math.min(1.0, rawOverlap / denom) : 0;
                    let embeddedBonus = 0;
                    if (intentVecMap.size > 0) {
                        const sessionVecs: number[][] = [];
                        for (const si of sessionIntent) {
                            const v = intentVecMap.get(mesh._canonicalizeIntent(si));
                            if (v) sessionVecs.push(v);
                        }
                        const chainVecs: number[][] = [];
                        for (const ci of intentChain) {
                            const v = intentVecMap.get(mesh._canonicalizeIntent(ci));
                            if (v) chainVecs.push(v);
                        }
                        embeddedBonus = mesh._heritageBonusFromVectors(sessionVecs, chainVecs, denom);
                    }
                    heritageBonus = Math.max(rawBonus, embeddedBonus);
                }
            } catch { /* no heritage */ }
        }

        // Recency decay: exp(-λ × age_days), λ tuned per memory type so
        // lessons/decisions age slowly and events age fast (workspace-pu2).
        const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
        const memType = (meta && typeof meta.type === 'string') ? meta.type : undefined;
        const λ = (memType && DECAY_BY_TYPE[memType] !== undefined)
            ? DECAY_BY_TYPE[memType]
            : DEFAULT_DECAY;
        let recencyDecay = 1.0;
        try {
            const createdAt = doc.created_at || doc.metadata?.created_at;
            if (createdAt) {
                const ageDays = (now - new Date(createdAt).getTime()) / 86400000;
                recencyDecay = Math.exp(-λ * ageDays);
            }
        } catch { /* use 1.0 */ }

        const score = α * semanticScore + β * heritageBonus + γ * recencyDecay;
        return { doc, score, semanticScore, heritageBonus, recencyDecay, meta };
    });

    reranked.sort((a, b) => b.score - a.score);

    const results = reranked.slice(0, limit).map(({ doc, score, semanticScore, heritageBonus, recencyDecay, meta }, idx) => ({
        id: doc.id,
        content: doc.content,
        metadata: meta,
        score,
        semanticScore,
        heritageBonus,
        recencyDecay,
        rrfRank: idx + 1,
    }));

    // Layer 5: Synthesis (skip if LLM unavailable)
    let synthesis: string | undefined;
    let synthesized = false;
    if (enableSynthesis && mesh.llmClient) {
        try {
            const excerpts = results.slice(0, 5).map((r, i) => `[${i + 1}] ${r.content}`).join('\n');
            synthesis = await mesh.llmClient.complete(
                `You are a retrieval synthesis agent. Given the following memory excerpts, produce a coherent summary that directly answers the query.\nQuery: ${scrubbed}\nExcerpts:\n${excerpts}`
            );
            synthesized = true;
        } catch { /* non-fatal, skip synthesis */ }
    }

    return {
        results,
        ...(synthesis !== undefined ? { synthesis } : {}),
        pipeline: {
            queryExpanded: enableHyDE,
            heritageAware: hasHeritage,
            synthesized,
            latencyMs: Date.now() - t0,
        },
    };
}


/**
 * Canonicalize an intent string for caching + lookup. Mirrors
 * _canonicalizeEntity's lightweight normalization but preserves
 * intent vocabulary (no plural stripping — "debug" and "debugs" are
 * legitimately different verbs/states in intent chains).
 * @private
 */
export function _canonicalizeIntent(_mesh: MemoryMesh, intent: string) {
    if (!intent || typeof intent !== 'string') return '';
    return intent.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Embed a single intent string with persistent caching. Intents are
 * low-cardinality (handfuls per project) and stable across queries, so
 * the cache hits hard. Cap at 500 entries with LRU eviction. Returns
 * null on any failure so callers can fall back to raw overlap.
 * @private
 */

export async function _embedIntent(mesh: MemoryMesh, intent: string) {
    const key = mesh._canonicalizeIntent(intent);
    if (!key) return null;
    if (mesh.intentEmbedCache.has(key)) return mesh.intentEmbedCache.get(key);
    try {
        const vec = await mesh.embeddingFactory.embed(key);
        if (!Array.isArray(vec) || vec.length === 0) return null;
        // LRU eviction
        if (mesh.intentEmbedCache.size >= 500) {
            const firstKey = mesh.intentEmbedCache.keys().next().value;
            if (firstKey !== undefined) mesh.intentEmbedCache.delete(firstKey);
        }
        mesh.intentEmbedCache.set(key, vec);
        return vec;
    } catch (_e) {
        return null;
    }
}

/**
 * Heritage bonus from intent vector matrices. For each session intent,
 * take its max cosine similarity against any chain intent (MaxSim),
 * sum, divide by sessionIntent count. Vectors are assumed
 * L2-normalized (embedding service normalizes by default), so cosine =
 * dot product. Returns 0 on empty/invalid input.
 * @private
 */

export function _heritageBonusFromVectors(_mesh: MemoryMesh, sessionVecs: any, chainVecs: any, denom: number) {
    if (!sessionVecs?.length || !chainVecs?.length || !denom) return 0;
    let total = 0;
    for (const sv of sessionVecs) {
        let bestSim = -Infinity;
        for (const cv of chainVecs) {
            if (sv.length !== cv.length) continue;
            let dot = 0;
            for (let i = 0; i < sv.length; i++) dot += sv[i] * cv[i];
            if (dot > bestSim) bestSim = dot;
        }
        if (bestSim > 0) total += bestSim; // negative cosine = no credit
    }
    return Math.min(1.0, total / denom);
}

/**
 * Generate a HyDE (Hypothetical Document Embedding) expansion for a query.
 *
 * When an LLM is available, generates a 2-3 sentence hypothetical passage
 * that would directly answer the query — typically yields stronger vector
 * matches than the original short query because the generated text mirrors
 * the distribution of stored documents. Falls back to a template wrapper
 * if the LLM is disabled, fails, or times out (HYDE_TIMEOUT_MS, default 5s).
 *
 * Results are cached per-query with the same TTL as queryCache.
 */

export async function _generateHyDE(mesh: MemoryMesh, query: string): Promise<string> {
    const template = `A document about ${query}. This covers concepts related to ${query} including patterns, insights, and lessons learned.`;
    if (!mesh.enableLLM || !mesh.llmClient) {
        return template;
    }
    const cacheKey = `hyde:${query}`;
    const cached = mesh.hydeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < mesh.cacheConfig.ttlMs) {
        return cached.text;
    }
    const timeoutMs = parseInt(process.env.HYDE_TIMEOUT_MS || '5000', 10);
    const systemPrompt = 'You are a search retrieval assistant. Given a user query, write a concise 2-3 sentence hypothetical passage that would directly answer it. Use technical vocabulary that would appear in a real document on this topic. Output only the passage, no preamble or commentary.';
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('HyDE LLM timeout')), timeoutMs);
        });
        const hydeText = await Promise.race([
            mesh.llmClient.complete(systemPrompt, query),
            timeoutPromise,
        ]);
        const cleaned = (hydeText && typeof hydeText === 'string' && hydeText.trim())
            ? hydeText.trim()
            : template;
        // LRU eviction
        const cap = 200;
        if (mesh.hydeCache.size >= cap) {
            const firstKey = mesh.hydeCache.keys().next().value;
            if (firstKey !== undefined) mesh.hydeCache.delete(firstKey);
        }
        mesh.hydeCache.set(cacheKey, { text: cleaned, timestamp: Date.now() });
        return cleaned;
    } catch (error) {
        if (process.env.YAMO_DEBUG === 'true') {
            logger.debug({ err: error, query }, 'HyDE LLM call failed, using template');
        }
        return template;
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

