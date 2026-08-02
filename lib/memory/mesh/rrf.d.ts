/**
 * Reciprocal Rank Fusion — the single implementation behind the search()
 * hybrid merge, smora() multi-channel fusion, and searchSkills() fusion
 * (workspace-cg2: previously three divergent inline copies).
 *
 * Scores each doc as Σ weight / (k + rank + 1) across the given ranked lists
 * (k = 60 by default) and returns entries sorted by fused score descending
 * (stable sort: ties keep first-seen order). The doc kept per id is the first
 * occurrence across lists in list order — put the richer channel first.
 */
export interface RrfEntry<T> {
    id: string;
    rrfScore: number;
    doc: T;
}
export declare function rrfMerge<T extends {
    id: string;
}>(lists: Array<{
    items: T[];
    weight?: number;
}>, k?: number): Array<RrfEntry<T>>;
