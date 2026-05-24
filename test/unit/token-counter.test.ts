/**
 * Tests for the character-class-aware TokenCounter (workspace-m81).
 *
 * Validates that the new heuristic addresses the documented pathologies
 * of the old char/4 estimate:
 *   - English prose: ballpark unchanged
 *   - Code: significantly higher (dense punctuation tokenizes 1:1)
 *   - CJK: significantly higher (each char ≈ 1-2 BPE tokens, not 0.25)
 * The old chars/4 estimate would have been catastrophically wrong on
 * both code and CJK chunks, silently overflowing maxTokens limits.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TokenCounter } from '../../lib/scrubber/utils/token-counter.js';

const tc = new TokenCounter();

describe('TokenCounter.count — character-class-aware', () => {
  it('returns 0 for empty / null input', () => {
    assert.strictEqual(tc.count(''), 0);
    assert.strictEqual(tc.count(null), 0);
    assert.strictEqual(tc.count(undefined), 0);
  });

  it('English prose: ballpark of words/0.75 (no regression from old estimate)', () => {
    // "The quick brown fox jumps over the lazy dog." (9 words, 44 chars)
    // cl100k actual ≈ 10 tokens; our estimate should be in [8, 14].
    const sentence = 'The quick brown fox jumps over the lazy dog.';
    const n = tc.count(sentence);
    assert.ok(n >= 8 && n <= 14, `expected 8-14, got ${n}`);
  });

  it('CJK: each char counts as ~1.5 tokens (was 0.25 under chars/4)', () => {
    // "今日は良い天気ですね" (10 chars). cl100k ≈ 11 tokens.
    const cjk = '今日は良い天気ですね';
    const n = tc.count(cjk);
    // Old impl: ceil(10/4) = 3 — would let huge CJK chunks slip past maxTokens.
    // New impl: ceil(10*1.5) = 15. Real cl100k ≈ 10-12 tokens. We over-estimate
    // slightly but that's safe (chunker stays under budget).
    assert.ok(n >= 10, `expected ≥10 for CJK, got ${n}`);
  });

  it('code with dense punctuation: counts significantly higher than chars/4', () => {
    const code = 'function foo(a, b) { return a + b; }';
    const oldEstimate = Math.ceil(code.length / 4); // ~9
    const n = tc.count(code);
    // Real cl100k tokenizes this as ~14 tokens. We should beat the naive 9.
    assert.ok(n > oldEstimate, `expected > ${oldEstimate} (old), got ${n}`);
    assert.ok(n >= 10, `expected ≥10 for code, got ${n}`);
  });

  it('symbol-heavy strings count each symbol as a token', () => {
    const symbols = '!@#$%^&*()';
    const n = tc.count(symbols);
    // 10 symbols → 10 tokens (one per symbol)
    assert.strictEqual(n, 10);
  });

  it('digit groups count as one token per group', () => {
    // "version 1.2.3 build 456" — 3 digit groups in the version, 1 in build.
    // Symbols (the dots) add 2 more tokens.
    const text = 'version 1.2.3 build 456';
    const n = tc.count(text);
    // version (~2 toks) + 3 digit groups + 2 dots + build (~2 toks) + 1 digit group
    assert.ok(n >= 8 && n <= 14, `expected 8-14, got ${n}`);
  });

  it('mixed English + CJK + code beats old estimate', () => {
    const mixed = 'Function 関数 returns 結果; const x = 42;';
    const oldEstimate = Math.ceil(mixed.length / 4);
    const n = tc.count(mixed);
    assert.ok(n > oldEstimate, `expected new count > ${oldEstimate}, got ${n}`);
  });

  it('is deterministic — same input → same count', () => {
    const text = 'JWT tokens carry expiration claims and signing metadata';
    const a = tc.count(text);
    const b = tc.count(text);
    const c = tc.count(text);
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
  });

  it('handles a long doc without throwing', () => {
    const long = ('paragraph with various words '.repeat(100) +
                  'function fn() { return 1; } '.repeat(20) +
                  '日本語のテキスト '.repeat(10));
    const n = tc.count(long);
    assert.ok(n > 0);
    assert.ok(Number.isFinite(n));
  });
});

describe('TokenCounter.countAccurate — word-level metric (unchanged)', () => {
  it('counts words plus punctuation tokens', () => {
    const r = tc.countAccurate('hello, world!');
    // 2 words + 2 punctuation
    assert.strictEqual(r, 4);
  });
});
