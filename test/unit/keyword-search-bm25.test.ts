/**
 * BM25 keyword search tests (workspace-2di).
 *
 * Validates the in-memory BM25 fallback that's used when LanceDB's
 * Tantivy FTS index isn't available. Key properties:
 *   - Length normalization: short focused docs beat long padded ones for
 *     the same matching term frequency
 *   - Term-frequency saturation: 10× the term count doesn't 10× the score
 *   - BM25 IDF: rare terms outweigh common ones
 *   - k1 and b are tunable via constructor
 *   - Backward-compat: result shape unchanged
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { KeywordSearch } from '../../lib/memory/search/keyword-search.js';

describe('KeywordSearch — BM25 ranking', () => {
  it('preserves the public result shape (id, score, matches, content, metadata)', () => {
    const ks = new KeywordSearch();
    ks.add('a', 'JWT token expiration claims', { type: 'insight' });
    const r = ks.search('JWT', { limit: 5 });
    assert.strictEqual(r.length, 1);
    const row = r[0];
    assert.strictEqual(row.id, 'a');
    assert.strictEqual(typeof row.score, 'number');
    assert.ok(Array.isArray(row.matches));
    assert.strictEqual(row.content, 'JWT token expiration claims');
    assert.deepStrictEqual(row.metadata, { type: 'insight' });
  });

  it('honors length normalization — short doc beats padded long doc with same term count', () => {
    const ks = new KeywordSearch();
    // Both docs contain "redis" exactly once.
    ks.add('short', 'redis pipelining');
    ks.add('long', 'redis pipelining ' + 'filler content '.repeat(80));
    const r = ks.search('redis', { limit: 5 });
    // Both should match; the short doc should score higher with default b=0.75
    const short = r.find((x) => x.id === 'short')!;
    const long = r.find((x) => x.id === 'long')!;
    assert.ok(short && long);
    assert.ok(short.score > long.score, `expected short>long, got ${short.score} vs ${long.score}`);
  });

  it('saturates on term frequency — 10× repeats does not 10× the score', () => {
    const ks = new KeywordSearch();
    ks.add('one',     'redis one filler filler');
    ks.add('many',    ('redis '.repeat(10)) + 'filler filler');
    // Add a competing doc so IDF isn't 0
    ks.add('other',   'something completely different topic');
    const r = ks.search('redis', { limit: 5 });
    const one = r.find((x) => x.id === 'one')!;
    const many = r.find((x) => x.id === 'many')!;
    assert.ok(one && many);
    // many's score > one (it has more occurrences)
    assert.ok(many.score > one.score);
    // ...but not 10x — saturation kicks in
    assert.ok(many.score < 10 * one.score, `expected saturation, got ratio ${many.score / one.score}`);
  });

  it('rewards rare terms with higher IDF', () => {
    const ks = new KeywordSearch();
    // "common" appears in every doc; "rare" in only one.
    for (let i = 0; i < 9; i++) {
      ks.add(`doc-${i}`, 'common common common filler filler');
    }
    ks.add('special', 'common rare token here');
    const rCommon = ks.search('common', { limit: 20 });
    const rRare = ks.search('rare', { limit: 20 });
    // Top "rare" hit's score should beat top "common" hit's score
    assert.ok(rRare[0].score > rCommon[0].score, `rare ${rRare[0].score} should beat common ${rCommon[0].score}`);
  });

  it('returns 0-result array for a query with no matching tokens', () => {
    const ks = new KeywordSearch();
    ks.add('a', 'redis pipelining');
    const r = ks.search('zzzzzz', { limit: 5 });
    assert.deepStrictEqual(r, []);
  });

  it('handles single-doc corpus without negative IDF', () => {
    const ks = new KeywordSearch();
    ks.add('only', 'lonely document with words');
    const r = ks.search('lonely', { limit: 5 });
    assert.strictEqual(r.length, 1);
    assert.ok(r[0].score > 0, `expected positive score, got ${r[0].score}`);
  });

  it('honors custom k1 and b via constructor', () => {
    // b=0 disables length normalization; long and short should tie on tf=1
    const ks0 = new KeywordSearch({ b: 0 });
    ks0.add('short', 'redis pipelining');
    ks0.add('long', 'redis pipelining ' + 'filler '.repeat(80));
    const r0 = ks0.search('redis', { limit: 5 });
    const short0 = r0.find((x) => x.id === 'short')!.score;
    const long0 = r0.find((x) => x.id === 'long')!.score;
    assert.ok(Math.abs(short0 - long0) < 1e-9, `b=0 should equalize, got ${short0} vs ${long0}`);

    // Default (b=0.75) — short wins (covered above already)
    const ks1 = new KeywordSearch();
    ks1.add('short', 'redis pipelining');
    ks1.add('long', 'redis pipelining ' + 'filler '.repeat(80));
    const r1 = ks1.search('redis', { limit: 5 });
    assert.ok(r1.find((x) => x.id === 'short')!.score > r1.find((x) => x.id === 'long')!.score);
  });

  it('removes index entries on remove()', () => {
    const ks = new KeywordSearch();
    ks.add('a', 'redis pipelining');
    ks.add('b', 'redis sharding');
    ks.remove('a');
    const r = ks.search('redis', { limit: 5 });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].id, 'b');
  });

  it('respects the limit option', () => {
    const ks = new KeywordSearch();
    for (let i = 0; i < 7; i++) ks.add(`d-${i}`, `redis topic ${i}`);
    const r = ks.search('redis', { limit: 3 });
    assert.strictEqual(r.length, 3);
  });
});
