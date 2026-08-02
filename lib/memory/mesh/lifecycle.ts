/**
 * Lifecycle & curated-recall subsystem — extracted from the MemoryMesh
 * god-class (workspace-cg2). The beads-operational surface: lifecycle states,
 * deferral, pin/unpin, append-only revisions, history/restore, and prime()
 * push-based recall. Functions take the mesh facade as their first argument;
 * MemoryMesh delegates 1:1.
 */
import { createLogger } from "../../utils/logger.js";
import { MEMORY_STATES, MemoryState } from "../schema.js";
import { toEpochMs } from "./shared.js";
import type { MemoryRecord } from "../adapters/client.js";
import type { MemoryMesh } from "../memory-mesh.js";

const logger = createLogger("brain");

/**
 * SQL clause selecting rows visible to default recall (workspace-g9p.5):
 * not superseded, not archived (unless opted in), and not deferred to a
 * future date. Legacy rows with NULL state read as 'active'.
 */
export function _activeStateClause(_mesh: MemoryMesh, opts: { includeArchived?: boolean } = {}): string {
    const clauses = ["superseded_at IS NULL"];
    if (opts.includeArchived !== true) {
        clauses.push("(state IS NULL OR state != 'archived')");
    }
    const nowLiteral = new Date().toISOString().replace("T", " ").replace("Z", "");
    clauses.push(`(defer_until IS NULL OR defer_until <= TIMESTAMP '${nowLiteral}')`);
    return clauses.join(" AND ");
}
/**
 * Coerce a caller-supplied defer_until (Date | ISO string | epoch ms) to a
 * Date, or null when absent/invalid.
 */

export function _coerceDeferUntil(_mesh: MemoryMesh, value: unknown): Date | null {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === "string" || typeof value === "number") {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}
/**
 * Set a memory's lifecycle state (workspace-g9p.5). Vocabulary is
 * MEMORY_STATES: active | superseded | deprecated | archived.
 *
 * Archiving removes the row from the in-memory keyword index (it stays in
 * the DB and remains reachable via search({ includeArchived: true }));
 * re-activating restores it. Returns { id, state, previous }.
 */

export async function setState(mesh: MemoryMesh, id: string, state: MemoryState): Promise<{ id: string; state: MemoryState; previous: string | null }> {
    await mesh.init();
    if (!MEMORY_STATES.includes(state)) {
        throw new Error(`setState: invalid state '${state}' — expected one of ${MEMORY_STATES.join(", ")}`);
    }
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const record = await mesh.client.getById(id);
    if (!record) {
        throw new Error(`setState: memory ${id} not found`);
    }
    const previous = record.state ?? null;
    await mesh.client.update(id, { state });
    mesh._recordRevision(id, [{ field: "state", oldValue: previous, newValue: state }]);
    if (state === "archived") {
        mesh.keywordSearch?.remove?.(id);
    }
    else if (state === "active" && previous === "archived") {
        mesh.keywordSearch?.add?.(id, record.content, record.metadata ?? {});
    }
    // Visibility changed — cached search results predate it.
    mesh.queryCache.clear();
    return { id, state, previous };
}
/**
 * Defer a memory until a future date (workspace-g9p.5) — the bd defer
 * analog. The row is suppressed from default recall until `until`, then
 * resurfaces automatically (prime() lists newly-due rows under `due`).
 * Pass null to clear an existing deferral.
 */

export async function deferMemory(mesh: MemoryMesh, id: string, until: Date | string | number | null): Promise<{ id: string; defer_until: string | null }> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const record = await mesh.client.getById(id);
    if (!record) {
        throw new Error(`deferMemory: memory ${id} not found`);
    }
    const deferDate = until === null ? null : mesh._coerceDeferUntil(until);
    if (until !== null && !deferDate) {
        throw new Error(`deferMemory: invalid date '${String(until)}'`);
    }
    await mesh.client.update(id, { defer_until: deferDate });
    const previousMs = record.defer_until ? toEpochMs(record.defer_until) : null;
    mesh._recordRevision(id, [{
        field: "defer_until",
        oldValue: previousMs && !isNaN(previousMs) ? new Date(previousMs).toISOString() : null,
        newValue: deferDate ? deferDate.toISOString() : null,
    }]);
    if (deferDate && deferDate.getTime() > Date.now()) {
        mesh.keywordSearch?.remove?.(id);
    }
    else {
        mesh.keywordSearch?.add?.(id, record.content, record.metadata ?? {});
    }
    mesh.queryCache.clear();
    return { id, defer_until: deferDate ? deferDate.toISOString() : null };
}
/**
 * Append revision rows for an in-place mutation (workspace-g9p.3).
 *
 * Fire-and-forget by design — history must never add latency or failure
 * modes to the mutation hot path (same contract as _writeDecisionEdges).
 * Values are JSON-encoded; null means "absent".
 */

export function _recordRevision(mesh: MemoryMesh, memoryId: string, changes: Array<{ field: string; oldValue: unknown; newValue: unknown }>, actor?: string): void {
    if (!mesh.revisionTable || changes.length === 0) return;
    const enc = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
    const rows = changes.map((c) => ({
        id: `rev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        memory_id: memoryId,
        field: c.field,
        old_value: enc(c.oldValue),
        new_value: enc(c.newValue),
        actor: actor ?? mesh.agentId ?? null,
        created_at: new Date(),
    }));
    mesh.revisionTable.add(rows).catch((e: unknown) => {
        if (process.env.YAMO_DEBUG === "true") {
            logger.warn({ err: e, memoryId }, "Failed to record memory revision");
        }
    });
}
/**
 * Ordered mutation history for a memory or skill id (workspace-g9p.3) —
 * the bd history analog. Returns oldest-first revision rows with decoded
 * old/new values.
 */

export async function history(mesh: MemoryMesh, memoryId: string): Promise<Array<{ id: string; memory_id: string; field: string; old_value: unknown; new_value: unknown; actor: string | null; created_at: string }>> {
    await mesh.init();
    if (!mesh.revisionTable) return [];
    const escaped = memoryId.replace(/'/g, "''");
    const rows = await mesh.revisionTable
        .query()
        .where(`memory_id == '${escaped}'`)
        .toArray();
    const dec = (v: unknown) => {
        if (v === null || v === undefined) return null;
        try {
            return JSON.parse(String(v));
        }
        catch {
            return String(v);
        }
    };
    return rows
        .map((r: any) => ({
            id: r.id,
            memory_id: r.memory_id,
            field: r.field,
            old_value: dec(r.old_value),
            new_value: dec(r.new_value),
            actor: r.actor ?? null,
            created_at: new Date(toEpochMs(r.created_at)).toISOString(),
            _ms: toEpochMs(r.created_at),
        }))
        .sort((a: any, b: any) => a._ms - b._ms)
        .map(({ _ms, ...rest }: any) => rest);
}
/**
 * Restore a deleted memory from its 'deleted' revision (workspace-g9p.3) —
 * the bd restore analog. Re-embeds the captured content and re-inserts the
 * row under its original id.
 */

export async function restoreDeleted(mesh: MemoryMesh, id: string): Promise<{ id: string; content: string } | null> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const existing = await mesh.client.getById(id);
    if (existing) {
        return { id, content: existing.content };
    }
    const revisions = await mesh.history(id);
    const deletion = [...revisions].reverse().find((r) => r.field === "deleted" && r.old_value);
    if (!deletion) return null;
    const snapshot = deletion.old_value as { content?: string; metadata?: Record<string, unknown> };
    if (!snapshot || typeof snapshot.content !== "string") return null;
    const vector = await mesh.embeddingFactory.embed(snapshot.content);
    await mesh.client.add({
        id,
        vector,
        content: snapshot.content,
        metadata: JSON.stringify(snapshot.metadata ?? {}),
        state: "active",
        pinned: false,
        defer_until: null,
    });
    mesh.keywordSearch?.add?.(id, snapshot.content, snapshot.metadata ?? {});
    mesh._recordRevision(id, [{ field: "restored", oldValue: null, newValue: { from_revision: deletion.id } }]);
    mesh.queryCache.clear();
    return { id, content: snapshot.content };
}
/**
 * Resolve a memory by id, falling back to newest active row carrying
 * metadata.key == idOrKey. Used by pin()/unpin() so curated memories can
 * be addressed by their stable key (the bd remember --key analog).
 */

export async function _resolveIdOrKey(mesh: MemoryMesh, idOrKey: string): Promise<MemoryRecord | null> {
    if (!mesh.client) return null;
    const byId = await mesh.client.getById(idOrKey);
    if (byId) return byId;
    const escapedKey = idOrKey.replace(/'/g, "''");
    const matches = await mesh.client.getWhere(
        `metadata LIKE '%"key":"${escapedKey}"%' AND superseded_at IS NULL`,
        { limit: 50 },
    );
    if (matches.length === 0) return null;
    return matches.sort((a: any, b: any) => toEpochMs(b.created_at) - toEpochMs(a.created_at))[0];
}
/**
 * Pin a memory so prime() always surfaces it verbatim (workspace-g9p.1).
 * Accepts a memory id or a stable metadata.key.
 */

export async function pin(mesh: MemoryMesh, idOrKey: string): Promise<{ id: string; pinned: boolean }> {
    return mesh._setPinned(idOrKey, true);
}
/**
 * Unpin a memory (workspace-g9p.1). Accepts a memory id or metadata.key.
 */

export async function unpin(mesh: MemoryMesh, idOrKey: string): Promise<{ id: string; pinned: boolean }> {
    return mesh._setPinned(idOrKey, false);
}

export async function _setPinned(mesh: MemoryMesh, idOrKey: string, pinned: boolean): Promise<{ id: string; pinned: boolean }> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const record = await mesh._resolveIdOrKey(idOrKey);
    if (!record) {
        throw new Error(`${pinned ? "pin" : "unpin"}: no memory with id or key '${idOrKey}'`);
    }
    const previous = record.pinned === true;
    await mesh.client.update(record.id, { pinned });
    if (previous !== pinned) {
        mesh._recordRevision(record.id, [{ field: "pinned", oldValue: previous, newValue: pinned }]);
    }
    mesh.queryCache.clear();
    return { id: record.id, pinned };
}
/**
 * Push-based curated recall (workspace-g9p.1) — the bd prime analog.
 *
 * Returns three sections:
 *   pinned     — ALL pinned, non-superseded, non-archived memories,
 *                verbatim, regardless of any query similarity. Guaranteed
 *                surfacing is the whole point: probabilistic recall is the
 *                wrong tool for "never do X again" facts.
 *   due        — deferred memories whose defer_until has passed (bd defer
 *                resurfacing). Excludes rows already in pinned.
 *   contextual — top-N relevant unpinned memories for `query` via the
 *                normal search ranking; recent-important actives when no
 *                query is given.
 */

export async function prime(mesh: MemoryMesh, query?: string, opts: { limit?: number } = {}): Promise<{
    pinned: Array<{ id: string; content: string; metadata: Record<string, any> | null; created_at: string | null }>;
    due: Array<{ id: string; content: string; metadata: Record<string, any> | null; defer_until: string | null }>;
    contextual: Array<{ id: string; content: string; metadata: Record<string, any> | null; score: number }>;
}> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const limit = opts.limit ?? 5;
    const activeClause = mesh._activeStateClause();
    const toIso = (v: unknown) => {
        const ms = toEpochMs(v);
        return isNaN(ms) ? null : new Date(ms).toISOString();
    };
    // Section 1: pinned, oldest-first for stable output ordering.
    const pinnedRows = (await mesh.client.getWhere(`pinned = true AND ${activeClause}`, { limit: 500 }))
        .sort((a: any, b: any) => toEpochMs(a.created_at) - toEpochMs(b.created_at));
    const pinnedIds = new Set(pinnedRows.map((r: any) => r.id));
    const pinned = pinnedRows.map((r: any) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata ?? null,
        created_at: toIso(r.created_at),
    }));
    // Section 2: newly-due deferred rows. activeClause already constrains
    // defer_until to (NULL OR <= now); requiring NOT NULL leaves "due".
    const dueRows = (await mesh.client.getWhere(`defer_until IS NOT NULL AND ${activeClause}`, { limit: 100 }))
        .filter((r: any) => !pinnedIds.has(r.id))
        .sort((a: any, b: any) => toEpochMs(a.defer_until) - toEpochMs(b.defer_until));
    const dueIds = new Set(dueRows.map((r: any) => r.id));
    const due = dueRows.map((r: any) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata ?? null,
        defer_until: toIso(r.defer_until),
    }));
    // Section 3: contextual relevance via the normal ranking pipeline.
    let contextual: Array<{ id: string; content: string; metadata: Record<string, any> | null; score: number }> = [];
    if (query && query.trim().length > 0) {
        const results = await mesh.search(query, { limit: limit + pinnedIds.size + dueIds.size });
        contextual = results
            .filter((r) => !pinnedIds.has(r.id) && !dueIds.has(r.id))
            .slice(0, limit)
            .map((r) => ({
                id: r.id,
                content: r.content ?? "",
                metadata: r.metadata ?? null,
                score: r.score ?? 0,
            }));
    }
    else {
        // No query: most-important recent actives (overscan + JS sort — the
        // LanceDB query builder has no orderBy).
        const rows = await mesh.client.getWhere(activeClause, { limit: 2000 });
        contextual = rows
            .filter((r: any) => !pinnedIds.has(r.id) && !dueIds.has(r.id))
            .sort((a: any, b: any) => {
                const impA = typeof a.importance_score === "number" ? a.importance_score : 0.5;
                const impB = typeof b.importance_score === "number" ? b.importance_score : 0.5;
                if (impB !== impA) return impB - impA;
                return toEpochMs(b.created_at) - toEpochMs(a.created_at);
            })
            .slice(0, limit)
            .map((r: any) => ({
                id: r.id,
                content: r.content,
                metadata: r.metadata ?? null,
                score: typeof r.importance_score === "number" ? r.importance_score : 0.5,
            }));
    }
    return { pinned, due, contextual };
}
