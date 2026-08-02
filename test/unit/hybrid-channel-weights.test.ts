import { describe, it } from 'node:test';
import assert from 'node:assert';
import { _parseChannelWeight } from '../../lib/memory/mesh/search.js';
import { rrfMerge } from '../../lib/memory/mesh/rrf.js';

/**
 * Hybrid RRF channel weights (workspace-2cx): HYBRID_VECTOR_WEIGHT /
 * HYBRID_KEYWORD_WEIGHT env knobs. Parsing must never let a typo silence a
 * channel, and the weighted merge must actually shift ordering.
 */
describe('hybrid channel weights', () => {
  it('parses valid positive weights', () => {
    assert.strictEqual(_parseChannelWeight('0.4', 1.0), 0.4);
    assert.strictEqual(_parseChannelWeight('1', 1.0), 1);
    assert.strictEqual(_parseChannelWeight('2.5', 1.0), 2.5);
  });

  it('falls back to the default on unset, empty, NaN, zero, and negative', () => {
    assert.strictEqual(_parseChannelWeight(undefined, 1.0), 1.0);
    assert.strictEqual(_parseChannelWeight('', 1.0), 1.0);
    assert.strictEqual(_parseChannelWeight('abc', 1.0), 1.0);
    assert.strictEqual(_parseChannelWeight('0', 1.0), 1.0);
    assert.strictEqual(_parseChannelWeight('-0.5', 1.0), 1.0);
    assert.strictEqual(_parseChannelWeight('Infinity', 0.4), 0.4);
  });

  it('weighted rrfMerge shifts ordering the way the knob promises', () => {
    // Channel A ranks docs [x, y]; channel B ranks [y, x]. Equal weights tie
    // structurally (stable sort keeps first-seen first); down-weighting B must
    // let A's order win, up-weighting B must flip it.
    const a = { items: [{ id: 'x' }, { id: 'y' }] };
    const b = { items: [{ id: 'y' }, { id: 'x' }] };
    const equal = rrfMerge([a, b]).map((e) => e.id);
    assert.deepStrictEqual(equal, ['x', 'y'], 'equal weights: stable tie keeps first-list order');
    const aWins = rrfMerge([{ ...a, weight: 1.0 }, { ...b, weight: 0.4 }]).map((e) => e.id);
    assert.deepStrictEqual(aWins, ['x', 'y']);
    const bWins = rrfMerge([{ ...a, weight: 0.4 }, { ...b, weight: 1.0 }]).map((e) => e.id);
    assert.deepStrictEqual(bWins, ['y', 'x']);
  });
});
