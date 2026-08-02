export function rrfMerge(lists, k = 60) {
    const scores = new Map();
    const docs = new Map();
    for (const { items, weight = 1.0 } of lists) {
        for (let rank = 0; rank < items.length; rank++) {
            const doc = items[rank];
            if (!doc?.id)
                continue;
            scores.set(doc.id, (scores.get(doc.id) || 0) + weight / (k + rank + 1));
            if (!docs.has(doc.id))
                docs.set(doc.id, doc);
        }
    }
    return Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, rrfScore]) => ({ id, rrfScore, doc: docs.get(id) }));
}
