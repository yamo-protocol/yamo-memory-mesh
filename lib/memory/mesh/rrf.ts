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

export function rrfMerge<T extends { id: string }>(
    lists: Array<{ items: T[]; weight?: number }>,
    k = 60,
): Array<RrfEntry<T>> {
    const scores = new Map<string, number>();
    const docs = new Map<string, T>();
    for (const { items, weight = 1.0 } of lists) {
        for (let rank = 0; rank < items.length; rank++) {
            const doc = items[rank];
            if (!doc?.id) continue;
            scores.set(doc.id, (scores.get(doc.id) || 0) + weight / (k + rank + 1));
            if (!docs.has(doc.id)) docs.set(doc.id, doc);
        }
    }
    return Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, rrfScore]) => ({ id, rrfScore, doc: docs.get(id) as T }));
}
