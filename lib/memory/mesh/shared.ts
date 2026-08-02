/**
 * Shared internal constants and helpers for the MemoryMesh facade and its
 * seam modules (workspace-cg2). Lives outside memory-mesh.ts so seam modules
 * can import values without a runtime cycle (their MemoryMesh import is
 * type-only and erases at compile time).
 */

/**
 * Per-memory-type recency decay rates (λ) for smora()'s recency_decay
 * factor (recency = exp(-λ × age_days)). Calibrated so half-life roughly
 * matches the expected useful lifespan of each type:
 *
 *   lesson          λ=0.005  ≈ 140d  — preventative wisdom (RFC-0011)
 *   decision        λ=0.01   ≈  70d  — architectural decisions
 *   consolidation   λ=0.01   ≈  70d  — converged beliefs (kernel brain)
 *   summary_l3      λ=0.01   ≈  70d  — RAPTOR upper layers (more abstract)
 *   summary_l2      λ=0.015  ≈  46d
 *   summary_l1      λ=0.02   ≈  35d  — RAPTOR base summaries
 *   reflection      λ=0.02   ≈  35d  — meta-observations
 *   pattern         λ=0.02   ≈  35d
 *   insight         λ=0.02   ≈  35d
 *   debug           λ=0.03   ≈  23d  — fixes age moderately
 *   event           λ=0.05   ≈  14d  — episodic interactions
 *   recall          λ=0.05   ≈  14d
 *
 * Unknown types fall back to DEFAULT_DECAY (current behavior preserved).
 */
export const DECAY_BY_TYPE: Record<string, number> = {
    lesson: 0.005,
    decision: 0.01,
    consolidation: 0.01,
    summary_l3: 0.01,
    summary_l2: 0.015,
    summary_l1: 0.02,
    reflection: 0.02,
    pattern: 0.02,
    insight: 0.02,
    debug: 0.03,
    event: 0.05,
    recall: 0.05,
};
export const DEFAULT_DECAY = 0.05;

/** Coerce a LanceDB timestamp value (Date | number | bigint | string) to epoch ms. */
export function toEpochMs(v: unknown): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "number") return v;
    if (typeof v === "string") return new Date(v).getTime();
    return Number.NaN;
}

// Safety ceiling for unbounded metadata scans (queryLessons / getMemoriesByPattern).
// Far above any realistic lesson count, but bounds memory if a store grows pathologically.
// Hitting it is logged (not silent) so it never recreates the old getAll(1000) truncation bug quietly.
export const METADATA_SCAN_CAP = 50000;
