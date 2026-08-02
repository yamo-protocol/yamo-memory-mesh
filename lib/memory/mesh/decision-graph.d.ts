import type { MemoryMesh, RankedMemory } from "../memory-mesh.js";
/**
 * Decision edges whose endpoints resolve to no known memory or skill row
 * (workspace-g9p.6). The DCG direction invariant says targets pre-exist at
 * write time — a dangling endpoint means a deletion broke lineage.
 */
export declare function orphanEdges(mesh: MemoryMesh, opts?: {
    limit?: number;
}): Promise<Array<{
    id: string;
    source_id: string;
    target_id: string;
    relation: string;
    missing: string[];
}>>;
/**
 * Coerce a metadata edge field (string | string[] | undefined) into a
 * clean array of target memory IDs.
 */
export declare function _coerceIdList(_mesh: MemoryMesh, value: unknown): string[];
/**
 * Decide whether a write should emit Decision Context Graph edges. Gated so
 * the common (non-decision) write path does no edge work at all.
 */
export declare function _isDecisionWrite(mesh: MemoryMesh, metadata: any, supersededIds: string[]): boolean;
/**
 * Write Decision Context Graph edges for a freshly stored memory.
 *
 * source_id is always the new memory; target_id always pre-exists. Edges:
 *   - supersedes   from the belief-revision step (supersededIds)
 *   - depends-on   from metadata.depends_on
 *   - justified-by from metadata.justified_by
 *   - contradicts  from metadata.contradicts
 */
export declare function _writeDecisionEdges(mesh: MemoryMesh, sourceId: string, metadata: any, supersededIds: string[]): Promise<void>;
/**
 * Traverse the Decision Context Graph from a memory.
 *
 * Distinct from the Graph-RAG boost traversal — this answers reasoning-audit
 * questions over decision_edges, not retrieval scoring.
 *
 *   direction 'ancestors'  (default): follow outgoing edges (source_id ==
 *     node) — "what this decision supersedes / depends on / is justified by".
 *   direction 'dependents': follow incoming edges (target_id == node) —
 *     "this decision was reversed; what still-active decisions rested on it?"
 */
export declare function decisionLineage(mesh: MemoryMesh, memoryId: string, opts?: {
    direction?: "ancestors" | "dependents";
    relations?: string[];
    maxHops?: number;
}): Promise<Array<{
    from: string;
    to: string;
    relation: string;
    rationale: string | null;
    weight: number;
    hop: number;
}>>;
/**
 * Contradiction-aware ranking (workspace-g9p.4) — the retrieval-time
 * analog of bd's "blocked". A result with a `contradicts` edge from a
 * NEWER memory whose outcome is `validated` is down-ranked (score × 0.5)
 * and flagged via `contradicted_by`, so stale beliefs lose ranking
 * contests against what actually replaced them. No-op when the Decision
 * Context Graph is empty; failures never break search.
 */
export declare function _applyContradictionPenalty(mesh: MemoryMesh, results: RankedMemory[]): Promise<RankedMemory[]>;
/**
 * Stale-beliefs report (workspace-g9p.4) — bd blocked pointed backward at
 * beliefs. For each refuted decision (or the given memoryId), walks
 * decisionLineage(dependents) and surfaces every memory still resting on
 * it, with hop counts.
 */
export declare function staleBeliefs(mesh: MemoryMesh, opts?: {
    memoryId?: string;
    maxHops?: number;
}): Promise<Array<{
    refuted: {
        id: string;
        content: string | null;
        note: string | null;
    };
    dependents: Array<{
        id: string;
        relation: string;
        hop: number;
        content: string | null;
        state: string | null;
    }>;
}>>;
/**
 * Record the observed outcome of a decision, closing the feedback loop.
 *
 * Stores `outcome` in the decision's metadata and resets importance_score by
 * status so retrieval ranking reflects whether the decision actually worked
 * (not merely how often it was read): validated 0.9, mixed 0.5, refuted 0.2.
 */
export declare function recordOutcome(mesh: MemoryMesh, decisionId: string, outcome: {
    status: "validated" | "refuted" | "mixed";
    note?: string;
}): Promise<void>;
