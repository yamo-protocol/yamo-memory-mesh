/**
 * Write-path subsystem — extracted from the MemoryMesh god-class
 * (workspace-cg2). add() with scrubbing, semantic injection, dedup, the
 * opt-in agentic-ops LLM judge, belief revision, graph-triple and
 * decision-edge emission; addDocument() late-chunked ingest; heritage
 * insertion; and metadata/content validation. Functions take the mesh facade
 * as their first argument; MemoryMesh delegates 1:1.
 */
import crypto from "crypto";
import { createLogger } from "../../utils/logger.js";
import { scanForInjection } from "../../utils/prompt-security.js";
import { YamoEmitter } from "../../yamo/emitter.js";
const logger = createLogger("brain");
/**
 * Validate and sanitize metadata to prevent prototype pollution
 * @private
 */
export function _validateMetadata(mesh, metadata) {
    if (typeof metadata !== "object" || metadata === null) {
        throw new Error("Metadata must be a non-null object");
    }
    // Sanitize keys to prevent prototype pollution
    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
        // Skip dangerous keys that could pollute prototype
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
            continue;
        }
        // Skip inherited properties
        if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
            continue;
        }
        sanitized[key] = value;
    }
    return sanitized;
}
/**
 * Sanitize and validate content before storage
 * @private
 */
export function _sanitizeContent(mesh, content) {
    if (typeof content !== "string") {
        throw new Error("Content must be a string");
    }
    // Limit content length
    const MAX_CONTENT_LENGTH = 100000; // 100KB limit
    if (content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
    }
    return content.trim();
}
/**
 * Add content to memory with auto-generated embedding and scrubbing.
 *
 * This is the primary method for storing information in the memory mesh.
 * The content goes through several processing steps:
 *
 * 1. **Scrubbing**: PII and sensitive data are sanitized (if enabled)
 * 2. **Validation**: Content length and metadata are validated
 * 3. **Embedding**: Content is converted to a vector representation
 * 4. **Storage**: Record is stored in LanceDB with metadata
 * 5. **Emission**: Optional YAMO block emitted for provenance tracking
 *
 * @param content - The text content to store in memory
 * @param metadata - Optional metadata (type, source, tags, etc.)
 * @returns Promise with memory record containing id, content, metadata, created_at
 *
 * @example
 * ```typescript
 * const memory = await mesh.add("User likes TypeScript", {
 *   type: "preference",
 *   source: "chat",
 *   tags: ["programming", "languages"]
 * });
 * ```
 *
 * @throws {Error} If content exceeds max length (100KB)
 * @throws {Error} If embedding generation fails
 * @throws {Error} If database client is not initialized
 */
export async function add(mesh, content, metadata = {}) {
    await mesh.init();
    const type = metadata.type || "event";
    const enrichedMetadata = { ...metadata, type };
    try {
        let documentContext = metadata.documentContext || metadata.situatedContext || null;
        if (!documentContext && content && content.length > 0) {
            const title = metadata.title || metadata.source || metadata.sourceFilePath || null;
            if (title) {
                documentContext = `From document/source: ${title}`;
            }
            else {
                const firstLine = content.split('\n')[0].trim();
                if (firstLine.startsWith('#')) {
                    documentContext = `From section: ${firstLine.replace(/^#+\s+/, '')}`;
                }
            }
        }
        let processedContent = content;
        let scrubbedMetadata = {};
        try {
            const scrubbedResult = await mesh.scrubber.process({
                content: content,
                source: "memory-api",
                type: "txt",
                documentContext: documentContext,
            });
            if (scrubbedResult.success && scrubbedResult.chunks.length > 0) {
                processedContent = scrubbedResult.chunks
                    .map((c) => c.text)
                    .join("\n\n");
                if (scrubbedResult.metadata) {
                    scrubbedMetadata = {
                        ...scrubbedResult.metadata,
                        scrubber_telemetry: JSON.stringify(scrubbedResult.telemetry),
                    };
                }
            }
        }
        catch (scrubError) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.error({ err: scrubError }, "Scrubber failed");
            }
        }
        // Mutable: agentic MERGE may rewrite sanitizedContent and re-embed.
        let sanitizedContent = mesh._sanitizeContent(processedContent);
        // Prompt-injection scan (workspace-s7a): flag content matching
        // common attack signatures (instruction overrides, chat-marker
        // abuse, role swaps, exfiltration intent, jailbreak triggers).
        // Don't reject — the user might legitimately discuss these
        // patterns (research notes, security writeups). Output guard in
        // formatResults() fences flagged content with [UNTRUSTED] markers.
        const injectionScan = scanForInjection(sanitizedContent);
        const sanitizedMetadata = mesh._validateMetadata({
            ...scrubbedMetadata,
            ...enrichedMetadata,
            ...(injectionScan.score > 0 ? {
                injection_risk: injectionScan.score >= 2 ? 'high' : 'low',
                injection_patterns: injectionScan.patterns,
            } : {}),
        });
        if (process.env.YAMO_DEBUG === "true") {
            console.error("[DEBUG] brain.add() scrubbedMetadata.type:", scrubbedMetadata.type);
            console.error("[DEBUG] brain.add() enrichedMetadata.type:", enrichedMetadata.type);
            console.error("[DEBUG] brain.add() sanitizedMetadata.type:", sanitizedMetadata.type);
        }
        // Semantic injection: prepend V5 fields before embedding so the vector
        // space clusters around explicit topics/entities (Phase 5 Step 1).
        let embeddingText = sanitizedContent;
        if (mesh.semanticInjection) {
            const topics = sanitizedMetadata.topics;
            const entities = sanitizedMetadata.entities;
            const parts = [];
            if (Array.isArray(topics) && topics.length > 0) {
                parts.push(`[TOPICS: ${topics.join(", ")}]`);
            }
            if (Array.isArray(entities) && entities.length > 0) {
                parts.push(`[ENTITIES: ${entities.join(", ")}]`);
            }
            if (parts.length > 0) {
                embeddingText = `${parts.join(" ")} ${sanitizedContent}`;
            }
        }
        // Mutable: agentic MERGE may re-embed after rewriting content.
        let vector = await mesh.embeddingFactory.embed(embeddingText);
        // Three-zone routing against the nearest neighbor:
        //   similarity ≥ DEDUP_SIMILARITY_THRESHOLD (0.95)  → dedup short-circuit
        //   similarity ∈ [AGENTIC_OPS_GRAY_ZONE_MIN, threshold) → LLM judge
        //                                                        (only if enableAgenticOps)
        //   similarity < gray-zone min                     → plain ADD (fall through)
        //
        // Bypassed entirely when a higher-level idempotency mechanism owns it:
        //   - metadata.key            → belief-revision supersedes-by-key
        //   - metadata.replaces_memory_id → explicit replacement
        //   - metadata.lesson_pattern_id  → RFC-0011 lesson idempotency
        //   - metadata.skipDedup === true → caller opt-out
        const explicitVersioning = !!sanitizedMetadata.key ||
            !!sanitizedMetadata.replaces_memory_id ||
            !!sanitizedMetadata.lesson_pattern_id ||
            sanitizedMetadata.skipDedup === true;
        if (mesh.client && !explicitVersioning) {
            const nearest = await mesh.client.search(vector, { limit: 1 });
            if (nearest.length > 0) {
                const threshold = parseFloat(process.env.DEDUP_SIMILARITY_THRESHOLD || '0.95');
                const grayZoneMin = parseFloat(process.env.AGENTIC_OPS_GRAY_ZONE_MIN || '0.70');
                // Adapter returns LanceDB cosine _distance in `score` (range [0, 2]
                // for normalized embeddings). Convert to [0, 1] similarity.
                const rawDistance = typeof nearest[0].score === 'number' ? nearest[0].score : 1.0;
                const similarity = Math.max(0, Math.min(1, 1 - rawDistance / 2));
                const isExactMatch = nearest[0].content === sanitizedContent;
                if (isExactMatch || similarity >= threshold) {
                    // Zone 1: dedup
                    return {
                        id: nearest[0].id,
                        content: sanitizedContent,
                        metadata: sanitizedMetadata,
                        created_at: new Date().toISOString(),
                    };
                }
                if (mesh.enableAgenticOps && similarity >= grayZoneMin) {
                    // Zone 2: LLM judge — may rewrite sanitizedContent / vector
                    // and set sanitizedMetadata.replaces_memory_id.
                    const judgment = await mesh._judgeMemoryWrite(sanitizedContent, nearest[0]);
                    if (mesh.enableYamo) {
                        mesh._emitAgenticDecisionBlock(judgment, nearest[0].id, sanitizedContent).catch(() => { });
                    }
                    if (judgment.decision === 'NOOP') {
                        return {
                            id: nearest[0].id,
                            content: sanitizedContent,
                            metadata: sanitizedMetadata,
                            created_at: new Date().toISOString(),
                        };
                    }
                    if (judgment.decision === 'UPDATE') {
                        sanitizedMetadata.replaces_memory_id = nearest[0].id;
                    }
                    if (judgment.decision === 'MERGE' && judgment.mergedContent) {
                        sanitizedContent = mesh._sanitizeContent(judgment.mergedContent);
                        vector = await mesh.embeddingFactory.embed(sanitizedContent);
                        sanitizedMetadata.replaces_memory_id = nearest[0].id;
                    }
                    // ADD: fall through to insert path
                }
            }
        }
        const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        // Lifecycle columns (workspace-g9p.5 / g9p.1): every new row is born
        // 'active'; pinned and defer_until come from caller metadata.
        const deferUntil = mesh._coerceDeferUntil(sanitizedMetadata.defer_until);
        const record = {
            id,
            vector,
            content: sanitizedContent,
            metadata: JSON.stringify(sanitizedMetadata),
            state: "active",
            pinned: sanitizedMetadata.pinned === true,
            defer_until: deferUntil,
        };
        if (process.env.YAMO_DEBUG === "true") {
            console.error("[DEBUG] record.metadata.type:", JSON.parse(record.metadata).type);
        }
        if (!mesh.client) {
            throw new Error("Database client not initialized");
        }
        const result = await mesh.client.add(record);
        if (process.env.YAMO_DEBUG === "true") {
            try {
                console.error("[DEBUG] result.metadata.type:", JSON.parse(result.metadata).type);
            }
            catch {
                console.error("[DEBUG] result.metadata:", result.metadata);
            }
        }
        // Deferred rows stay out of the in-memory keyword index until due —
        // it has no SQL filter, so exclusion happens at add/hydrate time.
        if (!deferUntil || deferUntil.getTime() <= Date.now()) {
            mesh.keywordSearch.add(record.id, record.content, sanitizedMetadata);
        }
        // Invalidate cached search results — they predate this write.
        mesh.queryCache.clear();
        if (mesh.graphTable) {
            try {
                let triples = [];
                if (mesh.enableLLM && mesh.llmClient) {
                    triples = await mesh._extractTriplesLLM(sanitizedContent);
                }
                if (triples.length === 0) {
                    triples = mesh._extractTriplesHeuristics(sanitizedContent);
                }
                if (triples.length > 0) {
                    const edgeRecords = triples.map((t) => ({
                        id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        source: t.source,
                        target: t.target,
                        relation: t.relation,
                        weight: t.weight,
                        created_at: new Date(),
                    }));
                    await mesh.graphTable.add(edgeRecords);
                }
            }
            catch (graphError) {
                if (process.env.YAMO_DEBUG === "true") {
                    logger.error({ err: graphError }, "Failed to extract or store Graph-RAG triples");
                }
            }
        }
        // Epistemic Belief Revision. Collect every memory this write
        // supersedes so the Decision Context Graph can record `supersedes`
        // edges below — turning the pairwise superseded_at flag into a
        // walkable lineage edge at no extra reasoning cost.
        const supersededIds = [];
        if (mesh.client) {
            // 1. Direct replacement by replaces_memory_id
            if (sanitizedMetadata.replaces_memory_id) {
                try {
                    const targetId = sanitizedMetadata.replaces_memory_id;
                    await mesh.client.update(targetId, {
                        superseded_at: new Date(),
                        state: "superseded",
                    });
                    mesh._recordRevision(targetId, [{ field: "superseded_by", oldValue: null, newValue: result.id }]);
                    mesh.keywordSearch.remove(targetId);
                    supersededIds.push(targetId);
                }
                catch (e) {
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.warn({ err: e, id: sanitizedMetadata.replaces_memory_id }, "Failed to mark memory as superseded by ID");
                    }
                }
            }
            // 2. Semantic replacement by conflict tags (e.g. key)
            if (sanitizedMetadata.key) {
                try {
                    const escapedKey = sanitizedMetadata.key.replace(/'/g, "''");
                    const activeRecords = await mesh.client.getWhere(`metadata LIKE '%"key":"${escapedKey}"%' AND superseded_at IS NULL`);
                    for (const r of activeRecords) {
                        if (r.id !== result.id) {
                            await mesh.client.update(r.id, {
                                superseded_at: new Date(),
                                state: "superseded",
                            });
                            mesh._recordRevision(r.id, [{ field: "superseded_by", oldValue: null, newValue: result.id }]);
                            mesh.keywordSearch.remove(r.id);
                            supersededIds.push(r.id);
                        }
                    }
                }
                catch (e) {
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.warn({ err: e, key: sanitizedMetadata.key }, "Failed to mark memory as superseded by key");
                    }
                }
            }
        }
        // Decision Context Graph: gated to decision writes, fire-and-forget
        // so non-decision writes pay zero cost on the hot path.
        if (mesh.decisionEdgeTable && mesh._isDecisionWrite(sanitizedMetadata, supersededIds)) {
            mesh._writeDecisionEdges(result.id, sanitizedMetadata, supersededIds).catch((e) => {
                if (process.env.YAMO_DEBUG === "true") {
                    logger.warn({ err: e, id: result.id }, "Failed to write decision edges");
                }
            });
        }
        if (mesh.enableYamo) {
            mesh._emitYamoBlock("retain", result.id, YamoEmitter.buildRetainBlock({
                content: sanitizedContent,
                metadata: sanitizedMetadata,
                id: result.id,
                agentId: mesh.agentId,
                memoryType: sanitizedMetadata.type || "event",
            })).catch((error) => {
                // Log emission failures in debug mode but don't throw
                if (process.env.YAMO_DEBUG === "true") {
                    logger.warn({ err: error }, "Failed to emit YAMO block (retain)");
                }
            });
        }
        return {
            id: result.id,
            content: sanitizedContent,
            metadata: sanitizedMetadata,
            created_at: new Date().toISOString(),
        };
    }
    catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
}
/**
 * Multi-chunk document ingest with Late Chunking (Jina, Sep 2024).
 *
 * Splits the document into chunks (paragraph-based for now — preserves
 * char offsets cleanly), embeds them with full-document context via
 * embedLateChunked() when the underlying model supports token-level
 * extraction, falls back to per-chunk embedding otherwise. Each chunk
 * lands as its own memory with provenance metadata linking back to the
 * parent document.
 *
 * Single-shot store path mesh.add() is unchanged — call addDocument()
 * explicitly when you want chunk-level retrieval granularity.
 *
 * Options:
 *   - minChunkChars / maxChunkChars: paragraph-merging bounds
 *     (defaults: 200 / 2000)
 *   - lateChunk: force on/off (default: auto — use Late Chunking if
 *     the embedder supports it and there's more than one chunk)
 */
export async function addDocument(mesh, content, metadata = {}, options = {}) {
    await mesh.init();
    if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('addDocument requires non-empty string content');
    }
    const minChars = options.minChunkChars ?? 200;
    const maxChars = options.maxChunkChars ?? 2000;
    // Single-shot fallback: small docs go through add() unchanged.
    if (content.length <= maxChars) {
        const mem = await mesh.add(content, metadata);
        return { documentId: mem.id, chunks: 1, ids: [mem.id], lateChunked: false };
    }
    const spans = mesh._splitParagraphSpans(content, minChars, maxChars);
    if (spans.length <= 1) {
        const mem = await mesh.add(content, metadata);
        return { documentId: mem.id, chunks: 1, ids: [mem.id], lateChunked: false };
    }
    const documentId = `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    // Late Chunking: try to compute all chunk vectors in one forward pass
    // over the full document. Returns null on unsupported model / failure.
    let lateVectors = null;
    const shouldLateChunk = options.lateChunk !== false;
    if (shouldLateChunk) {
        lateVectors = await mesh.embeddingFactory.embedLateChunked(content, spans);
        if (lateVectors && lateVectors.length !== spans.length) {
            // Defensive: mismatch means we can't trust the vectors.
            lateVectors = null;
        }
    }
    const ids = [];
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const chunkText = content.slice(span.start, span.end).trim();
        if (chunkText.length === 0)
            continue;
        const chunkMetadata = {
            ...metadata,
            document_id: documentId,
            document_chunk_index: i,
            document_chunk_count: spans.length,
            late_chunked: !!lateVectors,
            // skipDedup: chunks of one document are intentionally similar
            // (shared themes); content-level dedup would collapse them.
            skipDedup: true,
        };
        if (lateVectors) {
            // Late-chunked path: store with pre-computed vector. We bypass
            // mesh.add()'s embed step and write directly via client.add().
            const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const record = {
                id,
                vector: lateVectors[i],
                content: chunkText,
                metadata: JSON.stringify(mesh._validateMetadata(chunkMetadata)),
            };
            if (!mesh.client)
                throw new Error('Database client not initialized');
            const result = await mesh.client.add(record);
            mesh.keywordSearch?.add?.(result.id, chunkText, chunkMetadata);
            ids.push(result.id);
        }
        else {
            // Fallback: per-chunk add() (loses cross-chunk context but works).
            const mem = await mesh.add(chunkText, chunkMetadata);
            ids.push(mem.id);
        }
    }
    // The late-chunk path writes directly via client.add(), bypassing the
    // cache clear in add(). Do it here so cached searches don't go stale.
    mesh.queryCache.clear();
    return { documentId, chunks: ids.length, ids, lateChunked: !!lateVectors };
}
/**
 * Split a document into paragraph-based spans of (start, end) char
 * offsets, merging short paragraphs to honor minChars and forcing breaks
 * when exceeding maxChars. Spans are non-overlapping, ordered, and cover
 * the full content.
 * @private
 */
export function _splitParagraphSpans(mesh, content, minChars, maxChars) {
    const spans = [];
    const paraRegex = /\n\n+/g;
    const paraStarts = [0];
    let m;
    while ((m = paraRegex.exec(content)) !== null) {
        paraStarts.push(m.index + m[0].length);
    }
    paraStarts.push(content.length);
    // paraStarts[i]..paraStarts[i+1] (minus trailing blank) defines paragraph i
    let chunkStart = 0;
    let chunkEnd = 0;
    for (let i = 0; i < paraStarts.length - 1; i++) {
        const paraStart = paraStarts[i];
        const paraEnd = paraStarts[i + 1];
        const currentLen = chunkEnd - chunkStart;
        const wouldBeLen = paraEnd - chunkStart;
        if (currentLen === 0) {
            chunkStart = paraStart;
            chunkEnd = paraEnd;
        }
        else if (currentLen >= minChars && wouldBeLen > maxChars) {
            // Flush current chunk, start fresh
            spans.push({ start: chunkStart, end: chunkEnd });
            chunkStart = paraStart;
            chunkEnd = paraEnd;
        }
        else {
            chunkEnd = paraEnd;
        }
    }
    if (chunkEnd > chunkStart)
        spans.push({ start: chunkStart, end: chunkEnd });
    return spans;
}
/**
 * Update a memory entry's heritage_chain (RFC-0011 §8).
 */
export async function insertHeritage(mesh, memoryId, heritage) {
    await mesh.init();
    if (!mesh.client)
        throw new Error("Database client not initialized");
    try {
        const record = await mesh.client.getById(memoryId);
        if (!record)
            return;
        const existingMeta = typeof record.metadata === "string"
            ? JSON.parse(record.metadata) : (record.metadata || {});
        await mesh.client.update(memoryId, {
            metadata: JSON.stringify({ ...existingMeta, heritage_chain: JSON.stringify(heritage) }),
        });
        // Emit RFC-0007 §5 heritage block
        if (mesh.enableYamo) {
            const ts = new Date().toISOString();
            const heritageBlock = [
                `agent: MemoryMesh_${mesh.agentId};`,
                `intent: record_heritage_chain;`,
                `context:`,
                `  memory_id;${memoryId};`,
                `  intent_chain;${heritage.intentChain.join(",")};`,
                `  timestamp;${ts};`,
                `output:`,
                `  heritage_recorded;true;`,
                `log: heritage_inserted;memory;${memoryId};timestamp;${ts};`,
                `handoff: End;`,
            ].join("\n");
            mesh._emitYamoBlock("heritage", memoryId, heritageBlock, heritage).catch(() => { });
        }
    }
    catch (error) {
        if (error instanceof Error && error.message.includes("not found"))
            return;
        throw error;
    }
}
/**
 * Agentic memory write judge (Mem0 / A-MEM / Letta pattern).
 *
 * Called from add() when a candidate memory falls in the gray zone of
 * similarity to an existing neighbor (similar but not a duplicate).
 * The LLM decides one of:
 *   - ADD:    new memory is genuinely new info → store alongside
 *   - UPDATE: new memory supersedes existing one → mark existing as
 *             superseded via metadata.replaces_memory_id
 *   - MERGE:  combine the two into a single richer memory → rewrite
 *             content and supersede the existing
 *   - NOOP:   new memory adds nothing the existing one doesn't cover
 *
 * Falls back to ADD on any failure (LLM disabled, throws, times out,
 * returns malformed JSON, returns an unknown decision). Latency bounded
 * by AGENTIC_OPS_TIMEOUT_MS (default 5000ms).
 */
export async function _judgeMemoryWrite(mesh, newContent, neighbor) {
    if (!mesh.enableLLM || !mesh.llmClient) {
        return { decision: 'ADD' };
    }
    const timeoutMs = parseInt(process.env.AGENTIC_OPS_TIMEOUT_MS || '5000', 10);
    const systemPrompt = 'You are a memory curator. Given a NEW candidate memory and the most semantically similar EXISTING memory already stored, choose exactly one action:\n- ADD: the new memory contains genuinely new information not in the existing one; store both.\n- UPDATE: the new memory is a more recent or more accurate version of the existing one; replace it.\n- MERGE: the two memories together would be more useful as one combined memory; provide merged_content.\n- NOOP: the new memory adds nothing the existing one does not already cover; skip storage.\n\nReply with ONLY a JSON object on a single line: {"decision":"ADD"|"UPDATE"|"MERGE"|"NOOP","merged_content":"...","rationale":"one short sentence"}\nOmit merged_content unless decision is MERGE.';
    const userPrompt = `NEW memory:\n"${newContent}"\n\nEXISTING memory:\n"${neighbor.content}"\n\nDecision:`;
    let timeoutHandle;
    try {
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('Agentic ops LLM timeout')), timeoutMs);
        });
        const responseText = await Promise.race([
            mesh.llmClient.complete(systemPrompt, userPrompt),
            timeoutPromise,
        ]);
        const cleaned = String(responseText)
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
        const parsed = JSON.parse(cleaned);
        const decision = parsed.decision;
        if (decision !== 'ADD' && decision !== 'UPDATE' && decision !== 'MERGE' && decision !== 'NOOP') {
            return { decision: 'ADD' };
        }
        if (decision === 'MERGE' && (typeof parsed.merged_content !== 'string' || !parsed.merged_content.trim())) {
            // MERGE without usable merged_content falls back to ADD to avoid data loss.
            return { decision: 'ADD' };
        }
        return {
            decision,
            mergedContent: typeof parsed.merged_content === 'string' ? parsed.merged_content.trim() : undefined,
            rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
        };
    }
    catch (error) {
        if (process.env.YAMO_DEBUG === 'true') {
            logger.debug({ err: error }, 'Agentic ops judge failed, defaulting to ADD');
        }
        return { decision: 'ADD' };
    }
    finally {
        if (timeoutHandle)
            clearTimeout(timeoutHandle);
    }
}
/**
 * Emit a YAMO block recording an agentic ops decision for provenance.
 * Non-critical — failures are swallowed (caller wraps in .catch).
 */
export async function _emitAgenticDecisionBlock(mesh, judgment, neighborId, newContent) {
    if (!mesh.yamoTable)
        return;
    const ts = new Date().toISOString();
    const yamoText = [
        `agent: MemoryMesh_${mesh.agentId};`,
        'intent: agentic_memory_decision;',
        'context:',
        `  neighbor_memory_id;${neighborId};`,
        `  candidate_excerpt;${newContent.slice(0, 120).replace(/;/g, '%3B')};`,
        `  timestamp;${ts};`,
        'output:',
        `  decision;${judgment.decision};`,
        ...(judgment.rationale ? [`  rationale;${judgment.rationale.replace(/;/g, '%3B')};`] : []),
        'log: agentic_decision;decision;' + judgment.decision + ';neighbor;' + neighborId + ';timestamp;' + ts + ';',
        'handoff: End;',
    ].join('\n');
    await mesh._emitYamoBlock('agentic_decision', neighborId, yamoText);
}
