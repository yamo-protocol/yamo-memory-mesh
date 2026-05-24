/**
 * ColBERT late-interaction tests.
 *
 * - maxSim / normalizedMaxSim pure-function math
 * - EmbeddingService.embedTokens: returns Float32Array + shape, normalizes
 *   per-token, drops special tokens via [0,0] offsets
 * - EmbeddingFactory.colbertRerank: orders candidates by MaxSim score,
 *   bails cleanly when model can't produce token embeddings
 * - MemoryMesh.smora({enableColbert: true}) wires through to factory
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { maxSim, normalizedMaxSim, TokenMatrix } from '../../lib/memory/embeddings/colbert.js';
import EmbeddingService from '../../lib/memory/embeddings/service.js';
import EmbeddingFactory from '../../lib/memory/embeddings/factory.js';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

const tm = (tokens: number[][]): TokenMatrix => ({
  data: new Float32Array(tokens.flat()),
  numTokens: tokens.length,
  dim: tokens[0]?.length ?? 0,
});

describe('colbert.maxSim', () => {
  it('returns 0 for empty query or doc', () => {
    assert.strictEqual(maxSim(tm([]), tm([[1, 0]])), 0);
    assert.strictEqual(maxSim(tm([[1, 0]]), tm([])), 0);
  });

  it('throws on dim mismatch', () => {
    assert.throws(() => maxSim(tm([[1, 0]]), tm([[1, 0, 0]])), /dim mismatch/);
  });

  it('sums per-query-token max similarity', () => {
    // 2 query tokens, 3 doc tokens, dim 2 — unit vectors
    const q = tm([[1, 0], [0, 1]]);
    const d = tm([[1, 0], [0.5, 0.866], [0, 1]]); // matches q0 perfectly, q1 perfectly
    // q0 max sim = 1.0 (with d0); q1 max sim = 1.0 (with d2). Total = 2.0
    assert.ok(Math.abs(maxSim(q, d) - 2.0) < 1e-6);
  });

  it('penalizes queries whose tokens have no good doc match', () => {
    const q = tm([[1, 0], [0, 1]]);
    const dGood = tm([[1, 0], [0, 1]]);
    const dBad = tm([[1, 0], [1, 0]]); // both doc tokens align with q0, none with q1
    assert.ok(maxSim(q, dGood) > maxSim(q, dBad));
  });
});

describe('colbert.normalizedMaxSim', () => {
  it('divides by query token count to land in [0, 1]', () => {
    const q = tm([[1, 0], [0, 1]]);
    const d = tm([[1, 0], [0, 1]]);
    // raw = 2.0, normalized = 1.0
    assert.ok(Math.abs(normalizedMaxSim(q, d) - 1.0) < 1e-6);
  });

  it('returns 0 for empty query', () => {
    assert.strictEqual(normalizedMaxSim(tm([]), tm([[1, 0]])), 0);
  });

  it('clamps to [0, 1]', () => {
    // Pathological case shouldn't matter with unit vectors, but verify clamp.
    const q = tm([[2, 0]]); // not normalized — dot product can exceed 1
    const d = tm([[2, 0]]);
    const s = normalizedMaxSim(q, d);
    assert.ok(s <= 1.0, `expected clamp, got ${s}`);
    assert.ok(s >= 0);
  });
});

describe('EmbeddingService.embedTokens', () => {
  it('returns null when backend is not local', async () => {
    const svc: any = new EmbeddingService({ modelName: 'm', modelType: 'ollama' });
    svc.initialized = true;
    assert.strictEqual(await svc.embedTokens('text'), null);
  });

  it('returns null when text is empty', async () => {
    const svc: any = new EmbeddingService({ modelName: 'm', modelType: 'local' });
    svc.initialized = true;
    assert.strictEqual(await svc.embedTokens(''), null);
  });

  it('returns null when model output is pooled (2D, not 3D)', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    svc.model = async () => ({ dims: [1, 4], data: new Float32Array([1, 0, 0, 0]) });
    assert.strictEqual(await svc.embedTokens('text'), null);
  });

  it('returns Float32Array + shape for valid 3D output', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    // 3 tokens, dim 2 — raw vectors (will be normalized inside embedTokens)
    svc.model = async () => ({
      dims: [1, 3, 2],
      data: new Float32Array([2, 0, 0, 2, 1, 1]),
    });
    svc.model.tokenizer = () => Promise.resolve({
      offset_mapping: [[0, 1], [1, 2], [2, 3]],
    });
    const r = await svc.embedTokens('abc');
    assert.ok(r);
    assert.strictEqual(r!.numTokens, 3);
    assert.strictEqual(r!.dim, 2);
    // Each token vector should be L2-normalized to unit length
    for (let t = 0; t < 3; t++) {
      const mag = Math.sqrt(r!.data[t * 2] ** 2 + r!.data[t * 2 + 1] ** 2);
      assert.ok(Math.abs(mag - 1.0) < 1e-6, `token ${t} mag=${mag}`);
    }
  });

  it('drops special tokens via [0,0] offsets', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    // 4 tokens: CLS, content, content, SEP
    svc.model = async () => ({
      dims: [1, 4, 2],
      data: new Float32Array([99, 99, 1, 0, 0, 1, 88, 88]),
    });
    svc.model.tokenizer = () => Promise.resolve({
      offset_mapping: [[0, 0], [0, 4], [4, 8], [0, 0]],
    });
    const r = await svc.embedTokens('text');
    assert.ok(r);
    assert.strictEqual(r!.numTokens, 2, 'CLS+SEP should be dropped');
  });
});

describe('EmbeddingFactory.colbertRerank', () => {
  it('returns candidates unchanged when query embedTokens fails', async () => {
    const factory: any = new EmbeddingFactory();
    factory.configured = true;
    factory.primaryService = {
      initialized: true,
      embedTokens: async () => null, // model unsupported
    };
    const candidates = [{ id: 'a', content: 'x' }, { id: 'b', content: 'y' }];
    const r = await factory.colbertRerank('query', candidates);
    assert.deepStrictEqual(r, candidates);
  });

  it('orders candidates by MaxSim and adds _colbertScore', async () => {
    const factory: any = new EmbeddingFactory();
    factory.configured = true;
    // Stub: query is [1,0]; candidate "match" → token [1,0], candidate "miss" → token [0,1]
    factory.primaryService = {
      initialized: true,
      embedTokens: async (text: string) => {
        if (text === 'query') {
          return { data: new Float32Array([1, 0]), numTokens: 1, dim: 2 };
        }
        if (text === 'match this') {
          return { data: new Float32Array([1, 0]), numTokens: 1, dim: 2 };
        }
        if (text === 'totally orthogonal') {
          return { data: new Float32Array([0, 1]), numTokens: 1, dim: 2 };
        }
        return null;
      },
    };
    const candidates = [
      { id: 'b', content: 'totally orthogonal' },
      { id: 'a', content: 'match this' },
    ];
    const r = await factory.colbertRerank('query', candidates);
    assert.strictEqual(r[0].id, 'a', 'matching candidate should rank first');
    assert.ok(r[0]._colbertScore > r[1]._colbertScore);
    assert.ok(r[0]._colbertScore <= 1.0 && r[0]._colbertScore >= 0);
  });

  it('returns empty array for empty candidates', async () => {
    const factory: any = new EmbeddingFactory();
    factory.configured = true;
    factory.primaryService = {};
    const r = await factory.colbertRerank('query', []);
    assert.deepStrictEqual(r, []);
  });
});

describe('MemoryMesh.smora — enableColbert option', () => {
  let mesh: any;
  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('invokes colbertRerank when options.enableColbert=true', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false, enableReranker: false });
    await mesh.init();
    await mesh.add('JWT tokens carry expiration claims');
    await mesh.add('Redis cache invalidation patterns');
    let colbertCalls = 0;
    mesh.embeddingFactory.colbertRerank = async (_q: string, cands: any[]) => {
      colbertCalls++;
      // Return unchanged but with marker so we can verify it ran
      return cands.map((c) => ({ ...c, _colbertScore: 0.5 }));
    };
    const r = await mesh.smora('how do JWT tokens work?', { limit: 5, enableColbert: true });
    assert.strictEqual(colbertCalls, 1);
    assert.ok(r.results.length > 0);
  });

  it('skips colbertRerank when options.enableColbert is unset (default)', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false, enableReranker: false });
    await mesh.init();
    await mesh.add('JWT tokens carry expiration claims');
    let colbertCalls = 0;
    mesh.embeddingFactory.colbertRerank = async () => {
      colbertCalls++;
      return [];
    };
    await mesh.smora('JWT', { limit: 5 });
    assert.strictEqual(colbertCalls, 0);
  });
});
