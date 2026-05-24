/**
 * Unit tests for retrieval eval metric functions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  recallAtK,
  reciprocalRank,
  ndcgAtK,
  meanMetrics,
  evaluateQuery,
} from '../../lib/eval/metrics.js';

const r = (...ids: string[]) => ids.map((id) => ({ id }));

describe('recallAtK', () => {
  it('returns 0 when gold is empty', () => {
    assert.strictEqual(recallAtK(r('a', 'b'), new Set(), 5), 0);
  });

  it('returns 1 when all gold is in top-k', () => {
    const gold = new Set(['a', 'c']);
    assert.strictEqual(recallAtK(r('a', 'b', 'c'), gold, 5), 1);
  });

  it('returns 0.5 when half the gold is in top-k', () => {
    const gold = new Set(['a', 'x']);
    assert.strictEqual(recallAtK(r('a', 'b', 'c'), gold, 5), 0.5);
  });

  it('respects k cutoff', () => {
    const gold = new Set(['c']);
    assert.strictEqual(recallAtK(r('a', 'b', 'c'), gold, 2), 0);
    assert.strictEqual(recallAtK(r('a', 'b', 'c'), gold, 3), 1);
  });
});

describe('reciprocalRank', () => {
  it('returns 1.0 when first result is gold', () => {
    assert.strictEqual(reciprocalRank(r('a', 'b'), new Set(['a'])), 1);
  });

  it('returns 0.5 when second result is gold', () => {
    assert.strictEqual(reciprocalRank(r('a', 'b'), new Set(['b'])), 0.5);
  });

  it('returns 0 when no gold appears', () => {
    assert.strictEqual(reciprocalRank(r('a', 'b'), new Set(['z'])), 0);
  });

  it('uses the first gold occurrence', () => {
    assert.strictEqual(reciprocalRank(r('a', 'b', 'c'), new Set(['b', 'c'])), 0.5);
  });
});

describe('ndcgAtK', () => {
  it('returns 1.0 when all gold ranks first', () => {
    const gold = new Set(['a', 'b']);
    assert.strictEqual(ndcgAtK(r('a', 'b', 'c'), gold, 10), 1);
  });

  it('returns 0 when no gold appears', () => {
    assert.strictEqual(ndcgAtK(r('x', 'y'), new Set(['a']), 10), 0);
  });

  it('penalizes lower ranks', () => {
    // Single gold at rank 1 → DCG = 1/log2(2) = 1, IDCG = 1 → nDCG = 1
    // Single gold at rank 2 → DCG = 1/log2(3) ≈ 0.6309, IDCG = 1 → nDCG ≈ 0.6309
    const goldFirst = ndcgAtK(r('a', 'b'), new Set(['a']), 10);
    const goldSecond = ndcgAtK(r('b', 'a'), new Set(['a']), 10);
    assert.ok(goldFirst > goldSecond);
    assert.strictEqual(goldFirst, 1);
    assert.ok(Math.abs(goldSecond - 1 / Math.log2(3)) < 1e-9);
  });

  it('caps idcg at min(k, |gold|)', () => {
    // 3 gold, k=2 → IDCG = 1/log2(2) + 1/log2(3) ≈ 1.6309
    // Results have all 3 gold in top 2? Impossible — only 2 slots. Best DCG with 2 gold in top-2 = IDCG.
    const gold = new Set(['a', 'b', 'c']);
    const score = ndcgAtK(r('a', 'b', 'x'), gold, 2);
    assert.strictEqual(score, 1);
  });

  it('returns 0 when gold is empty', () => {
    assert.strictEqual(ndcgAtK(r('a'), new Set(), 10), 0);
  });
});

describe('evaluateQuery + meanMetrics', () => {
  it('aggregates per-query metrics correctly', () => {
    const q1 = evaluateQuery(r('a', 'b'), new Set(['a'])); // MRR=1, R@5=1, nDCG@10=1
    const q2 = evaluateQuery(r('x', 'y'), new Set(['a'])); // MRR=0, R@5=0, nDCG@10=0
    const mean = meanMetrics([q1, q2]);
    assert.strictEqual(mean.mrr, 0.5);
    assert.strictEqual(mean.recall_at_5, 0.5);
    assert.strictEqual(mean.ndcg_at_10, 0.5);
  });

  it('returns zeros for empty input', () => {
    const mean = meanMetrics([]);
    assert.strictEqual(mean.mrr, 0);
    assert.strictEqual(mean.recall_at_10, 0);
  });
});
