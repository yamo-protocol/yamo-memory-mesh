/**
 * Decision Context Graph subsystem — extracted from the MemoryMesh god-class
 * (workspace-cg2). Typed memory-ID→memory-ID lineage (supersedes / depends-on /
 * justified-by / contradicts) in the decision_edges table, plus the
 * contradiction-aware ranking penalty and outcome recording. Kept separate
 * from the Graph-RAG boost graph (graph_edges) by design.
 *
 * Functions take the mesh facade as their first argument; MemoryMesh
 * delegates 1:1 — behavior and the public API are unchanged.
 */
import crypto from "crypto";
import { createLogger } from "../../utils/logger.js";
import { METADATA_SCAN_CAP } from "./shared.js";
import type { MemoryMesh, RankedMemory } from "../memory-mesh.js";

const logger = createLogger("brain");

/**
 * Decision edges whose endpoints resolve to no known memory or skill row
 * (workspace-g9p.6). The DCG direction invariant says targets pre-exist at
 * write time — a dangling endpoint means a deletion broke lineage.
 */
export async function orphanEdges(mesh: MemoryMesh, opts: { limit?: number } = {}): Promise<Array<{ id: string; source_id: string; target_id: string; relation: string; missing: string[] }>> {
    await mesh.init();
    if (!mesh.decisionEdgeTable) return [];
    const edges = await mesh.decisionEdgeTable.query().limit(opts.limit ?? 5000).toArray();
    if (edges.length === 0) return [];
    const known = new Set<string>();
    const collect = async (table: any) => {
        if (!table) return;
        try {
            const rows = await table.query().select(["id"]).toArray();
            for (const r of rows) known.add(r.id);
        }
        catch {
            const rows = await table.query().toArray();
            for (const r of rows) known.add(r.id);
        }
    };
    await collect(mesh.client?.table);
    await collect(mesh.skillTable);
    const orphans: Array<{ id: string; source_id: string; target_id: string; relation: string; missing: string[] }> = [];
    for (const e of edges) {
        const missing: string[] = [];
        if (!known.has(e.source_id)) missing.push(e.source_id);
        if (!known.has(e.target_id)) missing.push(e.target_id);
        if (missing.length > 0) {
            orphans.push({ id: e.id, source_id: e.source_id, target_id: e.target_id, relation: e.relation, missing });
        }
    }
    return orphans;
}

/**
 * Coerce a metadata edge field (string | string[] | undefined) into a
 * clean array of target memory IDs.
 */
export function _coerceIdList(mesh: MemoryMesh, value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((v): v is string => typeof v === "string" && v.length > 0);
    }
    if (typeof value === "string" && value.length > 0) {
        return [value];
    }
    return [];
}
/**
 * Decide whether a write should emit Decision Context Graph edges. Gated so
 * the common (non-decision) write path does no edge work at all.
 */

export function _isDecisionWrite(mesh: MemoryMesh, metadata: any, supersededIds: string[]): boolean {
    if (!metadata) return supersededIds.length > 0;
    return (
        metadata.type === "decision" ||
        supersededIds.length > 0 ||
        mesh._coerceIdList(metadata.depends_on).length > 0 ||
        mesh._coerceIdList(metadata.justified_by).length > 0 ||
        mesh._coerceIdList(metadata.contradicts).length > 0
    );
}
/**
 * Write Decision Context Graph edges for a freshly stored memory.
 *
 * source_id is always the new memory; target_id always pre-exists. Edges:
 *   - supersedes   from the belief-revision step (supersededIds)
 *   - depends-on   from metadata.depends_on
 *   - justified-by from metadata.justified_by
 *   - contradicts  from metadata.contradicts
 */

export async function _writeDecisionEdges(mesh: MemoryMesh, sourceId: string, metadata: any, supersededIds: string[]): Promise<void> {
    if (!mesh.decisionEdgeTable) return;
    const rationale = typeof metadata?.reasoning === "string" ? metadata.reasoning : null;
    const weight = typeof metadata?.hypothesis_confidence === "number" ? metadata.hypothesis_confidence : 1.0;
    // Collapse duplicate (target, relation) pairs within this write — a caller
    // passing depends_on: ['X','X'], or replaces_memory_id colliding with a
    // key-matched supersession, would otherwise emit identical rows. They
    // carry the same rationale/weight by construction, so dedup loses nothing.
    // Distinct relations to the same target are kept (different key). source_id
    // is unique per add(), so this is the only place duplicates can arise.
    const seen = new Set<string>();
    const edges: any[] = [];
    const addEdge = (targetId: string, relation: string) => {
        if (!targetId || targetId === sourceId) return;
        const key = `${targetId}\0${relation}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({
            id: `dedge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            source_id: sourceId,
            target_id: targetId,
            relation,
            rationale,
            weight,
            created_at: new Date(),
        });
    };
    for (const t of supersededIds) addEdge(t, "supersedes");
    for (const t of mesh._coerceIdList(metadata?.depends_on)) addEdge(t, "depends-on");
    for (const t of mesh._coerceIdList(metadata?.justified_by)) addEdge(t, "justified-by");
    for (const t of mesh._coerceIdList(metadata?.contradicts)) addEdge(t, "contradicts");
    if (edges.length > 0) {
        await mesh.decisionEdgeTable.add(edges);
    }
}
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

export async function decisionLineage(mesh: MemoryMesh,
    memoryId: string,
    opts: { direction?: "ancestors" | "dependents"; relations?: string[]; maxHops?: number } = {}
): Promise<Array<{ from: string; to: string; relation: string; rationale: string | null; weight: number; hop: number }>> {
    await mesh.init();
    if (!mesh.decisionEdgeTable) return [];
    const direction = opts.direction ?? "ancestors";
    const maxHops = opts.maxHops ?? 3;
    const relationFilter =
        opts.relations && opts.relations.length > 0
            ? ` AND relation IN (${opts.relations.map((r) => `'${r.replace(/'/g, "''")}'`).join(", ")})`
            : "";
    const out: Array<{ from: string; to: string; relation: string; rationale: string | null; weight: number; hop: number }> = [];
    const visited = new Set<string>([memoryId]);
    let frontier: string[] = [memoryId];
    for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
        const next: string[] = [];
        for (const node of frontier) {
            const col = direction === "ancestors" ? "source_id" : "target_id";
            const rows = await mesh.decisionEdgeTable
                .query()
                .where(`${col} == '${node.replace(/'/g, "''")}'${relationFilter}`)
                .toArray();
            for (const row of rows) {
                out.push({
                    from: row.source_id,
                    to: row.target_id,
                    relation: row.relation,
                    rationale: row.rationale ?? null,
                    weight: typeof row.weight === "number" ? row.weight : 1.0,
                    hop,
                });
                const other = direction === "ancestors" ? row.target_id : row.source_id;
                if (!visited.has(other)) {
                    visited.add(other);
                    next.push(other);
                }
            }
        }
        frontier = next;
    }
    return out;
}
/**
 * Contradiction-aware ranking (workspace-g9p.4) — the retrieval-time
 * analog of bd's "blocked". A result with a `contradicts` edge from a
 * NEWER memory whose outcome is `validated` is down-ranked (score × 0.5)
 * and flagged via `contradicted_by`, so stale beliefs lose ranking
 * contests against what actually replaced them. No-op when the Decision
 * Context Graph is empty; failures never break search.
 */

export async function _applyContradictionPenalty(mesh: MemoryMesh, results: RankedMemory[]): Promise<RankedMemory[]> {
    if (!mesh.decisionEdgeTable || results.length === 0) {
        return results;
    }
    try {
        const inList = results.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(", ");
        const edges = await mesh.decisionEdgeTable
            .query()
            .where(`relation == 'contradicts' AND target_id IN (${inList})`)
            .toArray();
        if (edges.length === 0) {
            return results;
        }
        const byTarget = new Map<string, any[]>();
        for (const e of edges) {
            const arr = byTarget.get(e.target_id) ?? [];
            arr.push(e);
            byTarget.set(e.target_id, arr);
        }
        // A contradiction only penalizes when the contradicting (newer)
        // memory has a validated outcome — an unproven contradiction is
        // just a disagreement, not evidence.
        const sourceIds: string[] = [...new Set<string>(edges.map((e: any) => e.source_id as string))];
        const validatedSources = new Set<string>();
        for (const sid of sourceIds) {
            const rec = await mesh.client?.getById(sid);
            if (rec?.metadata?.outcome?.status === "validated") {
                validatedSources.add(sid);
            }
        }
        if (validatedSources.size === 0) {
            return results;
        }
        let changed = false;
        const out = results.map((r) => {
            const contradictors = (byTarget.get(r.id) ?? [])
                .filter((e: any) => validatedSources.has(e.source_id))
                .map((e: any) => e.source_id as string);
            if (contradictors.length === 0) return r;
            changed = true;
            return { ...r, score: (r.score ?? 0) * 0.5, contradicted_by: [...new Set(contradictors)] };
        });
        if (changed) {
            out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        }
        return out;
    }
    catch (error) {
        if (process.env.YAMO_DEBUG === "true") {
            logger.warn({ err: error }, "Contradiction penalty failed — returning unpenalized results");
        }
        return results;
    }
}
/**
 * Stale-beliefs report (workspace-g9p.4) — bd blocked pointed backward at
 * beliefs. For each refuted decision (or the given memoryId), walks
 * decisionLineage(dependents) and surfaces every memory still resting on
 * it, with hop counts.
 */

export async function staleBeliefs(mesh: MemoryMesh, opts: { memoryId?: string; maxHops?: number } = {}): Promise<Array<{
    refuted: { id: string; content: string | null; note: string | null };
    dependents: Array<{ id: string; relation: string; hop: number; content: string | null; state: string | null }>;
}>> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    let refutedIds: string[];
    if (opts.memoryId) {
        refutedIds = [opts.memoryId];
    }
    else {
        const candidates = await mesh.client.getWhere(
            `metadata LIKE '%"status":"refuted"%'`,
            { limit: METADATA_SCAN_CAP },
        );
        refutedIds = candidates
            .filter((r: any) => r.metadata?.outcome?.status === "refuted")
            .map((r: any) => r.id as string);
    }
    const report: Array<{
        refuted: { id: string; content: string | null; note: string | null };
        dependents: Array<{ id: string; relation: string; hop: number; content: string | null; state: string | null }>;
    }> = [];
    for (const refutedId of refutedIds) {
        const record = await mesh.client.getById(refutedId);
        const lineage = await mesh.decisionLineage(refutedId, {
            direction: "dependents",
            maxHops: opts.maxHops ?? 3,
        });
        const seen = new Set<string>();
        const dependents: Array<{ id: string; relation: string; hop: number; content: string | null; state: string | null }> = [];
        for (const edge of lineage) {
            // dependents direction: `from` is the newer memory resting on the node.
            if (seen.has(edge.from)) continue;
            seen.add(edge.from);
            const dep = await mesh.client.getById(edge.from);
            dependents.push({
                id: edge.from,
                relation: edge.relation,
                hop: edge.hop,
                content: dep?.content ?? null,
                state: dep?.state ?? null,
            });
        }
        report.push({
            refuted: {
                id: refutedId,
                content: record?.content ?? null,
                note: record?.metadata?.outcome?.note ?? null,
            },
            dependents,
        });
    }
    return report;
}
/**
 * Record the observed outcome of a decision, closing the feedback loop.
 *
 * Stores `outcome` in the decision's metadata and resets importance_score by
 * status so retrieval ranking reflects whether the decision actually worked
 * (not merely how often it was read): validated 0.9, mixed 0.5, refuted 0.2.
 */

export async function recordOutcome(mesh: MemoryMesh,
    decisionId: string,
    outcome: { status: "validated" | "refuted" | "mixed"; note?: string }
): Promise<void> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const record = await mesh.client.getById(decisionId);
    if (!record) {
        throw new Error(`recordOutcome: memory ${decisionId} not found`);
    }
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
    const previousOutcome = metadata.outcome ?? null;
    metadata.outcome = {
        status: outcome.status,
        note: outcome.note ?? null,
        observed_at: new Date().toISOString(),
    };
    const importanceByStatus: Record<string, number> = { validated: 0.9, mixed: 0.5, refuted: 0.2 };
    const previousImportance = typeof record.importance_score === "number" ? record.importance_score : null;
    await mesh.client.update(decisionId, {
        metadata: JSON.stringify(metadata),
        importance_score: importanceByStatus[outcome.status],
    });
    mesh._recordRevision(decisionId, [
        { field: "importance_score", oldValue: previousImportance, newValue: importanceByStatus[outcome.status] },
        { field: "metadata.outcome", oldValue: previousOutcome, newValue: metadata.outcome },
    ]);
    // Ranking changed — drop cached search results that predate it.
    mesh.queryCache.clear();
}
