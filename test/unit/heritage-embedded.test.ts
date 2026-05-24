/**
 * Tests for embedded heritage rerank in smora() (workspace-bb4).
 *
 * The old heritage bonus used raw intent overlap (string includes).
 * Synonyms like "debug" vs "troubleshoot" got no credit. The new path
 * embeds intents (cached) and uses MaxSim cosine. Embedded augments
 * raw — heritage_bonus = max(rawOverlap, embeddedMaxSim) — so exact
 * matches always score at least as well as before.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('MemoryMesh — heritage helpers', () => {
  const mesh: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });

  describe('_canonicalizeIntent', () => {
    it('lowercases and trims', () => {
      assert.strictEqual(mesh._canonicalizeIntent('  Debug  '), 'debug');
    });
    it('normalizes hyphens / underscores', () => {
      assert.strictEqual(mesh._canonicalizeIntent('debug-failure'), 'debug failure');
      assert.strictEqual(mesh._canonicalizeIntent('debug_failure'), 'debug failure');
    });
    it('preserves plurals (unlike entity canonicalization)', () => {
      // debug vs debugs are legitimately different intent states
      assert.strictEqual(mesh._canonicalizeIntent('debugs'), 'debugs');
    });
    it('returns empty for falsy / non-string', () => {
      assert.strictEqual(mesh._canonicalizeIntent(''), '');
      assert.strictEqual(mesh._canonicalizeIntent(null), '');
      assert.strictEqual(mesh._canonicalizeIntent(undefined), '');
    });
  });

  describe('_heritageBonusFromVectors', () => {
    const vec = (...xs: number[]) => xs;

    it('returns 0 on empty inputs or zero denom', () => {
      assert.strictEqual(mesh._heritageBonusFromVectors([], [vec(1, 0)], 1), 0);
      assert.strictEqual(mesh._heritageBonusFromVectors([vec(1, 0)], [], 1), 0);
      assert.strictEqual(mesh._heritageBonusFromVectors([vec(1, 0)], [vec(1, 0)], 0), 0);
    });

    it('returns 1.0 when every session intent has a perfect chain match', () => {
      const sv = [vec(1, 0), vec(0, 1)];
      const cv = [vec(1, 0), vec(0, 1), vec(1, 1)]; // unit vectors plus one extra
      assert.ok(Math.abs(mesh._heritageBonusFromVectors(sv, cv, 2) - 1.0) < 1e-6);
    });

    it('averages per session intent (best match wins for each)', () => {
      // s0=[1,0] matches c0=[1,0] perfectly (sim=1)
      // s1=[0,1] matches c1=[0.7,0.7] partially (sim=0.7)
      // bonus = (1 + 0.7) / 2 = 0.85
      const sv = [vec(1, 0), vec(0, 1)];
      const cv = [vec(1, 0), vec(0.7, 0.7)];
      const b = mesh._heritageBonusFromVectors(sv, cv, 2);
      assert.ok(Math.abs(b - 0.85) < 1e-6, `expected 0.85, got ${b}`);
    });

    it('skips negative cosine (no credit for opposing direction)', () => {
      // s=[1,0] vs c=[-1,0] → dot=-1, no credit
      const b = mesh._heritageBonusFromVectors([vec(1, 0)], [vec(-1, 0)], 1);
      assert.strictEqual(b, 0);
    });

    it('ignores dim-mismatched chain vectors', () => {
      const b = mesh._heritageBonusFromVectors([vec(1, 0)], [vec(1, 0, 0)], 1);
      assert.strictEqual(b, 0, 'mismatched dim should skip, not crash');
    });

    it('clamps to [0, 1]', () => {
      // 3 session intents all matching at 1.0 → sum=3, denom=2 → clamp to 1.0
      const sv = [vec(1, 0), vec(1, 0), vec(1, 0)];
      const cv = [vec(1, 0)];
      const b = mesh._heritageBonusFromVectors(sv, cv, 2);
      assert.strictEqual(b, 1.0);
    });
  });
});

describe('MemoryMesh._embedIntent — caching', () => {
  let mesh: any;
  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('caches by canonical key (same intent in different casing hits cache)', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    let embedCalls = 0;
    mesh.embeddingFactory.embed = async () => {
      embedCalls++;
      return [1, 0, 0, 0];
    };
    await mesh._embedIntent('Debug');
    await mesh._embedIntent('debug');
    await mesh._embedIntent('  DEBUG  ');
    assert.strictEqual(embedCalls, 1, 'all three should canonicalize to same key');
  });

  it('returns null for falsy / failing embed', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    mesh.embeddingFactory.embed = async () => {
      throw new Error('embed down');
    };
    const r = await mesh._embedIntent('debug');
    assert.strictEqual(r, null);
  });

  it('returns null for empty / non-string intents without calling embed', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    let calls = 0;
    mesh.embeddingFactory.embed = async () => {
      calls++;
      return [1];
    };
    assert.strictEqual(await mesh._embedIntent(''), null);
    assert.strictEqual(await mesh._embedIntent(null), null);
    assert.strictEqual(calls, 0);
  });
});

describe('MemoryMesh.smora — embedded heritage rerank end-to-end', () => {
  let mesh: any;
  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('synonymous intents now receive heritage credit (was 0 under raw overlap)', async () => {
    mesh = new MemoryMesh({
      dbDir: ':memory:',
      enableYamo: false,
      enableLLM: false,
      enableReranker: false,
    });
    await mesh.init();
    // Stub embedding so "debug" and "troubleshoot" produce near-identical vectors
    // and "unrelated" produces an orthogonal one.
    mesh.embeddingFactory.embed = async (text: string) => {
      const t = text.toLowerCase();
      if (t === 'debug' || t === 'troubleshoot') return [1, 0, 0, 0];
      if (t === 'unrelated') return [0, 1, 0, 0];
      return [0, 0, 1, 0];
    };
    // Two candidate docs, each with a different heritage chain.
    const now = Date.now();
    const docs = [
      {
        id: 'syn-match',
        content: 'fix the bug in pipeline',
        metadata: JSON.stringify({
          type: 'event',
          heritage_chain: JSON.stringify({ intentChain: ['troubleshoot'], hypotheses: [], rationales: [] }),
        }),
        score: 0.5,
        created_at: new Date(now).toISOString(),
      },
      {
        id: 'no-match',
        content: 'log unrelated thing',
        metadata: JSON.stringify({
          type: 'event',
          heritage_chain: JSON.stringify({ intentChain: ['unrelated'], hypotheses: [], rationales: [] }),
        }),
        score: 0.5,
        created_at: new Date(now).toISOString(),
      },
    ];
    mesh.client.search = async () => docs;
    mesh.client.searchFts = async () => [];
    mesh.keywordSearch.search = () => [];

    const r = await mesh.smora('fix it', {
      limit: 5,
      enableHyDE: false,
      sessionIntent: ['debug'],
    });
    const synonymHit = r.results.find((x: any) => x.id === 'syn-match');
    const orthogonalHit = r.results.find((x: any) => x.id === 'no-match');
    assert.ok(synonymHit && orthogonalHit);
    // Synonym should get strong heritage bonus (~1.0 since [1,0,0,0]·[1,0,0,0]=1)
    assert.ok(synonymHit.heritageBonus > 0.9, `expected synonym bonus >0.9, got ${synonymHit.heritageBonus}`);
    // Orthogonal intent should get 0 (no exact match either)
    assert.strictEqual(orthogonalHit.heritageBonus, 0);
  });

  it('exact-match intents still score (raw overlap floor preserved)', async () => {
    mesh = new MemoryMesh({
      dbDir: ':memory:',
      enableYamo: false,
      enableLLM: false,
      enableReranker: false,
    });
    await mesh.init();
    // Force ONLY the intent-embedding path to fail; query/HyDE embeds still work.
    // This simulates "embeddings work generally but intent embedding errored."
    mesh._embedIntent = async () => null;
    const now = Date.now();
    mesh.client.search = async () => [
      {
        id: 'exact',
        content: 'X',
        metadata: JSON.stringify({
          heritage_chain: JSON.stringify({ intentChain: ['debug'], hypotheses: [], rationales: [] }),
        }),
        score: 0.5,
        created_at: new Date(now).toISOString(),
      },
    ];
    mesh.client.searchFts = async () => [];
    mesh.keywordSearch.search = () => [];

    const r = await mesh.smora('q', {
      limit: 5,
      enableHyDE: false,
      sessionIntent: ['debug'],
    });
    // Raw overlap: 1/1 = 1.0
    assert.strictEqual(r.results[0].heritageBonus, 1.0);
  });

  it('no heritage in metadata → heritageBonus stays 0', async () => {
    mesh = new MemoryMesh({
      dbDir: ':memory:',
      enableYamo: false,
      enableLLM: false,
      enableReranker: false,
    });
    await mesh.init();
    mesh.embeddingFactory.embed = async () => [1, 0, 0, 0];
    const now = Date.now();
    mesh.client.search = async () => [
      {
        id: 'no-heritage',
        content: 'X',
        metadata: JSON.stringify({ type: 'event' }),
        score: 0.5,
        created_at: new Date(now).toISOString(),
      },
    ];
    mesh.client.searchFts = async () => [];
    mesh.keywordSearch.search = () => [];

    const r = await mesh.smora('q', {
      limit: 5,
      enableHyDE: false,
      sessionIntent: ['debug'],
    });
    assert.strictEqual(r.results[0].heritageBonus, 0);
  });
});
