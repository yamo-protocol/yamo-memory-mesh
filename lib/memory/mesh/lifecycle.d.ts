import { MemoryState } from "../schema.js";
import type { MemoryRecord } from "../adapters/client.js";
import type { MemoryMesh } from "../memory-mesh.js";
/**
 * SQL clause selecting rows visible to default recall (workspace-g9p.5):
 * not superseded, not archived (unless opted in), and not deferred to a
 * future date. Legacy rows with NULL state read as 'active'.
 */
export declare function _activeStateClause(mesh: MemoryMesh, opts?: {
    includeArchived?: boolean;
}): string;
/**
 * Coerce a caller-supplied defer_until (Date | ISO string | epoch ms) to a
 * Date, or null when absent/invalid.
 */
export declare function _coerceDeferUntil(mesh: MemoryMesh, value: unknown): Date | null;
/**
 * Set a memory's lifecycle state (workspace-g9p.5). Vocabulary is
 * MEMORY_STATES: active | superseded | deprecated | archived.
 *
 * Archiving removes the row from the in-memory keyword index (it stays in
 * the DB and remains reachable via search({ includeArchived: true }));
 * re-activating restores it. Returns { id, state, previous }.
 */
export declare function setState(mesh: MemoryMesh, id: string, state: MemoryState): Promise<{
    id: string;
    state: MemoryState;
    previous: string | null;
}>;
/**
 * Defer a memory until a future date (workspace-g9p.5) — the bd defer
 * analog. The row is suppressed from default recall until `until`, then
 * resurfaces automatically (prime() lists newly-due rows under `due`).
 * Pass null to clear an existing deferral.
 */
export declare function deferMemory(mesh: MemoryMesh, id: string, until: Date | string | number | null): Promise<{
    id: string;
    defer_until: string | null;
}>;
/**
 * Append revision rows for an in-place mutation (workspace-g9p.3).
 *
 * Fire-and-forget by design — history must never add latency or failure
 * modes to the mutation hot path (same contract as _writeDecisionEdges).
 * Values are JSON-encoded; null means "absent".
 */
export declare function _recordRevision(mesh: MemoryMesh, memoryId: string, changes: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
}>, actor?: string): void;
/**
 * Ordered mutation history for a memory or skill id (workspace-g9p.3) —
 * the bd history analog. Returns oldest-first revision rows with decoded
 * old/new values.
 */
export declare function history(mesh: MemoryMesh, memoryId: string): Promise<Array<{
    id: string;
    memory_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
    actor: string | null;
    created_at: string;
}>>;
/**
 * Restore a deleted memory from its 'deleted' revision (workspace-g9p.3) —
 * the bd restore analog. Re-embeds the captured content and re-inserts the
 * row under its original id.
 */
export declare function restoreDeleted(mesh: MemoryMesh, id: string): Promise<{
    id: string;
    content: string;
} | null>;
/**
 * Resolve a memory by id, falling back to newest active row carrying
 * metadata.key == idOrKey. Used by pin()/unpin() so curated memories can
 * be addressed by their stable key (the bd remember --key analog).
 */
export declare function _resolveIdOrKey(mesh: MemoryMesh, idOrKey: string): Promise<MemoryRecord | null>;
/**
 * Pin a memory so prime() always surfaces it verbatim (workspace-g9p.1).
 * Accepts a memory id or a stable metadata.key.
 */
export declare function pin(mesh: MemoryMesh, idOrKey: string): Promise<{
    id: string;
    pinned: boolean;
}>;
/**
 * Unpin a memory (workspace-g9p.1). Accepts a memory id or metadata.key.
 */
export declare function unpin(mesh: MemoryMesh, idOrKey: string): Promise<{
    id: string;
    pinned: boolean;
}>;
export declare function _setPinned(mesh: MemoryMesh, idOrKey: string, pinned: boolean): Promise<{
    id: string;
    pinned: boolean;
}>;
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
export declare function prime(mesh: MemoryMesh, query?: string, opts?: {
    limit?: number;
}): Promise<{
    pinned: Array<{
        id: string;
        content: string;
        metadata: Record<string, any> | null;
        created_at: string | null;
    }>;
    due: Array<{
        id: string;
        content: string;
        metadata: Record<string, any> | null;
        defer_until: string | null;
    }>;
    contextual: Array<{
        id: string;
        content: string;
        metadata: Record<string, any> | null;
        score: number;
    }>;
}>;
