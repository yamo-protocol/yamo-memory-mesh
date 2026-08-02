import type { MemoryMesh } from "../memory-mesh.js";
/**
 * Passive human-readable JSONL export (workspace-g9p.2) — the issues.jsonl
 * principle. Vectors are derived data (re-embeddable from content), so the
 * export carries content + metadata only: git-committable, PR-diffable,
 * and sufficient for a full rebuild via importJsonl().
 *
 * Determinism contract: rows are sorted by (table, id), field order is
 * fixed, and no volatile values (export timestamps, floats re-derived at
 * export time) are included — consecutive exports of an unchanged DB are
 * byte-identical.
 */
export declare function exportJsonl(mesh: MemoryMesh, filePath?: string): Promise<{
    path: string | null;
    lines: number;
    text?: string;
}>;
/**
 * Import a JSONL export (workspace-g9p.2), re-embedding content locally.
 * Idempotent: rows whose id already exists in the target table are
 * skipped, so import-into-nonempty is safe.
 */
export declare function importJsonl(mesh: MemoryMesh, source: string | {
    text: string;
}): Promise<Record<string, {
    imported: number;
    skipped: number;
}>>;
/**
 * Non-mutating stale-memory report (workspace-g9p.6) — the bd stale
 * analog: active rows untouched (no access, no update) for `days`.
 */
export declare function staleMemoriesReport(mesh: MemoryMesh, opts?: {
    days?: number;
    limit?: number;
}): Promise<Array<{
    id: string;
    content: string;
    last_touch: string | null;
}>>;
/**
 * Hygiene self-diagnosis (workspace-g9p.6) — the bd doctor analog. Runs
 * mechanical checks for every known mesh footgun; never mutates. Overall
 * ok is the AND of all non-informational checks.
 */
export declare function doctor(mesh: MemoryMesh, opts?: {
    indexThreshold?: number;
}): Promise<{
    ok: boolean;
    checks: Array<{
        name: string;
        ok: boolean;
        detail: string;
    }>;
}>;
