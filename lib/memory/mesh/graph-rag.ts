/**
 * Graph-RAG subsystem — extracted from the MemoryMesh god-class
 * (workspace-cg2). Free-text entity triples in the graph_edges table that
 * boost search() scores via 1-hop/2-hop neighborhood traversal, plus entity
 * canonicalization and triple extraction (heuristic + LLM). Distinct from the
 * Decision Context Graph (mesh/decision-graph.ts) by design. Functions take
 * the mesh facade as their first argument; MemoryMesh delegates 1:1.
 */
import { createLogger } from "../../utils/logger.js";
import type { MemoryMesh, RankedMemory } from "../memory-mesh.js";

const logger = createLogger("brain");

export async function _applyGraphRagBoosting(mesh: MemoryMesh, results: RankedMemory[], query: string): Promise<RankedMemory[]> {
    if (!mesh.graphTable || results.length === 0) {
        return results;
    }
    try {
        // Extract candidate entities from the query, then canonicalize so
        // matching against (canonicalized) edge endpoints is case- and
        // plural-insensitive. Skip empty canonicals (e.g. lone "#" tokens).
        const rawQueryEntities = query.match(/\b([A-Z][a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)\b/g) || [];
        const queryEntitySet = new Set<string>();
        for (const raw of rawQueryEntities) {
            const c = mesh._canonicalizeEntity(raw);
            if (c) queryEntitySet.add(c);
        }
        if (queryEntitySet.size > 0) {
            const queryEntities = Array.from(queryEntitySet);
            const escapedEntities = queryEntities.map(e => e.replace(/'/g, "''"));
            const listStr = escapedEntities.map(e => `'${e}'`).join(", ");
            const filterExpr = `source IN (${listStr}) OR target IN (${listStr})`;
            const edges1 = await mesh.graphTable.query().where(filterExpr).toArray();

            const c1 = new Set<string>();
            for (const edge of edges1) {
                if (queryEntitySet.has(edge.source)) c1.add(edge.target);
                if (queryEntitySet.has(edge.target)) c1.add(edge.source);
            }

            const c2 = new Set<string>();
            if (c1.size > 0) {
                const escapedC1 = Array.from(c1).map(e => e.replace(/'/g, "''"));
                const listStrC1 = escapedC1.map(e => `'${e}'`).join(", ");
                const filterExprC1 = `source IN (${listStrC1}) OR target IN (${listStrC1})`;
                const edges2 = await mesh.graphTable.query().where(filterExprC1).toArray();

                for (const edge of edges2) {
                    if (c1.has(edge.source)) {
                        if (!queryEntitySet.has(edge.target) && !c1.has(edge.target)) {
                            c2.add(edge.target);
                        }
                    }
                    if (c1.has(edge.target)) {
                        if (!queryEntitySet.has(edge.source) && !c1.has(edge.source)) {
                            c2.add(edge.source);
                        }
                    }
                }
            }

            if (c1.size > 0 || c2.size > 0) {
                for (const doc of results) {
                    let hasC1 = false;
                    for (const entity of c1) {
                        if (mesh._contentMentions(doc.content ?? "", entity)) {
                            hasC1 = true;
                            break;
                        }
                    }
                    let hasC2 = false;
                    if (!hasC1 && c2.size > 0) {
                        for (const entity of c2) {
                            if (mesh._contentMentions(doc.content ?? "", entity)) {
                                hasC2 = true;
                                break;
                            }
                        }
                    }

                    if (hasC1) {
                        doc.score = Math.min(1.0, parseFloat((doc.score * 1.15).toFixed(2)));
                    } else if (hasC2) {
                        doc.score = Math.min(1.0, parseFloat((doc.score * 1.07).toFixed(2)));
                    }
                }
                results.sort((a, b) => b.score - a.score);
            }
        }
    } catch (graphError) {
        if (process.env.YAMO_DEBUG === "true") {
            logger.warn({ err: graphError }, "Failed to traverse Graph-RAG edges");
        }
    }
    return results;
}


/**
 * Canonicalize an entity string for graph storage and matching.
 * Lowercase, leading '#' stripped, hyphens/underscores → spaces,
 * trailing plural 's' stripped, whitespace collapsed. Lets the graph
 * unify "JWT", "jwt", "JWTs", "JWT-Token" / "jwt-tokens" etc.
 * @private
 */
export function _canonicalizeEntity(_mesh: MemoryMesh, entity: string) {
    if (!entity || typeof entity !== 'string') return '';
    return entity
        .toLowerCase()
        .replace(/^#/, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/s$/, '')
        .trim();
}

/**
 * Check if a content string mentions an entity using a case-insensitive
 * word-boundary regex with simple plural tolerance. Fixes the substring
 * false positives of the old `content.includes(entity)` check (where
 * "Auth" matched "AuthService" or "auth-token" matched "authorization").
 * @private
 */

export function _contentMentions(mesh: MemoryMesh, content: string, entity: string) {
    if (!entity || !content) return false;
    const canonical = mesh._canonicalizeEntity(entity);
    if (!canonical) return false;
    const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Trailing 's?' adds plural tolerance after canonicalization stripped it.
    const re = new RegExp(`\\b${escaped}s?\\b`, 'i');
    return re.test(content);
}

/**
 * Heuristic triple extractor — pairs consecutive PascalCase tokens with
 * a between-window verb guess. Produces low-precision edges that pollute
 * the Graph-RAG boost step. Disabled by default — return [] so no graph
 * noise from non-LLM writes.
 *
 * Opt in via GRAPH_RAG_HEURISTIC_TRIPLES=on env when running against a
 * corpus where you actually want PascalCase-pairing as a backstop. The
 * LLM path (_extractTriplesLLM) is the recommended graph source.
 */

export function _extractTriplesHeuristics(mesh: MemoryMesh, content: string) {
    if (process.env.GRAPH_RAG_HEURISTIC_TRIPLES !== 'on') return [];
    const triples = [];
    const terms = content.match(/\b([A-Z][a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)\b/g);
    if (terms && terms.length >= 2) {
        const uniqueTerms = Array.from(new Set(terms));
        for (let i = 0; i < uniqueTerms.length - 1; i++) {
            const sourceRaw = uniqueTerms[i];
            const targetRaw = uniqueTerms[i + 1];
            let relation = "relates_to";
            const pattern = new RegExp(`${sourceRaw}\\s+(\\w+)\\s+.*?${targetRaw}`, "i");
            const match = content.match(pattern);
            if (match && match[1]) {
                const verb = match[1].toLowerCase();
                if (["uses", "contains", "implements", "is", "has", "creates", "manages", "configures", "calls"].includes(verb)) {
                    relation = verb;
                }
            }
            const source = mesh._canonicalizeEntity(sourceRaw);
            const target = mesh._canonicalizeEntity(targetRaw);
            if (!source || !target || source === target) continue;
            triples.push({ source, target, relation, weight: 1.0 });
        }
    }
    return triples;
}


export async function _extractTriplesLLM(mesh: MemoryMesh, content: string) {
    if (!mesh.llmClient) return [];
    try {
        const prompt = `Extract entity-relation triples (Subject, Predicate, Object) from the following text.
Format the output as a JSON array of objects with keys: "source", "target", "relation", "weight" (0.0 to 1.0).
Only output the JSON array, nothing else.

Text: "${content}"`;

        const response = await mesh.llmClient.complete("You are a Graph-RAG entity extractor. Output ONLY valid JSON array.", prompt);

        const cleanedResponse = response.trim().replace(/^```json/, '').replace(/```$/, '').trim();
        const triples = JSON.parse(cleanedResponse);
        if (Array.isArray(triples)) {
            // Canonicalize entities so the graph unifies casing/plural variants.
            // Drop self-loops and empty endpoints (LLMs sometimes emit them).
            return triples
                .map((t) => ({
                    source: mesh._canonicalizeEntity(String(t.source ?? '')),
                    target: mesh._canonicalizeEntity(String(t.target ?? '')),
                    relation: String(t.relation ?? 'relates_to'),
                    weight: typeof t.weight === 'number' ? t.weight : 1.0,
                }))
                .filter((t) => t.source && t.target && t.source !== t.target);
        }
    } catch (err) {
        if (process.env.YAMO_DEBUG === "true") {
            logger.warn({ err }, "LLM triple extraction failed");
        }
    }
    return [];
}

