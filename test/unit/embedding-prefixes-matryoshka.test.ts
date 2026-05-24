/**
 * Tests for instruction prefixes + Matryoshka truncation in EmbeddingService.
 *
 * Validates:
 * - getInstructionPrefix() maps model names → correct prefix pair (or null)
 * - embed() prepends query/passage prefix when model is matched
 * - embed() leaves text unmodified when model has no prefix mapping
 * - EMBEDDING_INSTRUCTION_PREFIXES=off disables prefixing
 * - Query and passage embeddings cache separately (different cache keys)
 * - Matryoshka truncation slices to targetDimension and re-normalizes
 * - Truncation is no-op when targetDimension >= embedding length
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import EmbeddingService, { getInstructionPrefix } from '../../lib/memory/embeddings/service.js';

describe('getInstructionPrefix', () => {
  afterEach(() => {
    delete process.env.EMBEDDING_INSTRUCTION_PREFIXES;
  });

  it('returns null for MiniLM (no prefix family)', () => {
    assert.strictEqual(getInstructionPrefix('Xenova/all-MiniLM-L6-v2'), null);
  });

  it('returns null for BGE-M3 (trained without prefixes)', () => {
    assert.strictEqual(getInstructionPrefix('Xenova/bge-m3'), null);
    assert.strictEqual(getInstructionPrefix('BAAI/bge-m3'), null);
  });

  it('returns BGE v1.5 asymmetric prefix (query only)', () => {
    const p = getInstructionPrefix('Xenova/bge-base-en-v1.5');
    assert.ok(p);
    assert.ok(p!.query.includes('Represent this sentence'));
    assert.strictEqual(p!.passage, '');
  });

  it('returns Nomic-embed-text symmetric task prefixes', () => {
    const p = getInstructionPrefix('nomic-ai/nomic-embed-text-v1.5');
    assert.deepStrictEqual(p, { query: 'search_query: ', passage: 'search_document: ' });
  });

  it('returns E5 symmetric query/passage prefixes', () => {
    const p = getInstructionPrefix('intfloat/e5-base-v2');
    assert.deepStrictEqual(p, { query: 'query: ', passage: 'passage: ' });
  });

  it('returns null when EMBEDDING_INSTRUCTION_PREFIXES=off', () => {
    process.env.EMBEDDING_INSTRUCTION_PREFIXES = 'off';
    assert.strictEqual(getInstructionPrefix('Xenova/bge-base-en-v1.5'), null);
  });

  it('returns null for empty / null model name', () => {
    assert.strictEqual(getInstructionPrefix(''), null);
    assert.strictEqual(getInstructionPrefix(null as any), null);
  });
});

/**
 * Set up a service with a stubbed _embedLocal so the prefix path is
 * exercised without needing an actual ONNX download. We capture the text
 * actually passed to the model to verify prefix application.
 */
function makeStubbedService(modelName: string, embedSpy?: { lastText?: string }) {
  const svc: any = new EmbeddingService({ modelName, modelType: 'local', dimension: 4 });
  svc.initialized = true; // bypass init()
  svc.model = (text: string) => {
    if (embedSpy) embedSpy.lastText = text;
    // Return a deterministic non-zero vector so normalization works.
    return Promise.resolve({ data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]) });
  };
  svc._embedLocal = async (text: string) => {
    if (embedSpy) embedSpy.lastText = text;
    return [1, 2, 3, 4, 5, 6, 7, 8];
  };
  return svc;
}

describe('EmbeddingService.embed — instruction prefixes', () => {
  it('prepends BGE query prefix when isQuery=true', async () => {
    const spy: { lastText?: string } = {};
    const svc = makeStubbedService('Xenova/bge-base-en-v1.5', spy);
    await svc.embed('what is JWT?', { isQuery: true });
    assert.ok(spy.lastText?.startsWith('Represent this sentence for searching relevant passages: '));
    assert.ok(spy.lastText?.endsWith('what is JWT?'));
  });

  it('uses empty passage prefix when isQuery=false (BGE asymmetric)', async () => {
    const spy: { lastText?: string } = {};
    const svc = makeStubbedService('Xenova/bge-base-en-v1.5', spy);
    await svc.embed('JWT tokens carry expiry claims', { isQuery: false });
    assert.strictEqual(spy.lastText, 'JWT tokens carry expiry claims');
  });

  it('uses symmetric prefixes for E5 family', async () => {
    const spyQ: { lastText?: string } = {};
    const spyP: { lastText?: string } = {};
    const svcQ = makeStubbedService('intfloat/e5-base-v2', spyQ);
    const svcP = makeStubbedService('intfloat/e5-base-v2', spyP);
    await svcQ.embed('what?', { isQuery: true });
    await svcP.embed('an answer', { isQuery: false });
    assert.strictEqual(spyQ.lastText, 'query: what?');
    assert.strictEqual(spyP.lastText, 'passage: an answer');
  });

  it('leaves text untouched for MiniLM (no prefix family)', async () => {
    const spy: { lastText?: string } = {};
    const svc = makeStubbedService('Xenova/all-MiniLM-L6-v2', spy);
    await svc.embed('plain text', { isQuery: true });
    assert.strictEqual(spy.lastText, 'plain text');
  });

  it('leaves text untouched for BGE-M3 (no prefix needed)', async () => {
    const spy: { lastText?: string } = {};
    const svc = makeStubbedService('Xenova/bge-m3', spy);
    await svc.embed('multilingual content', { isQuery: true });
    assert.strictEqual(spy.lastText, 'multilingual content');
  });

  it('caches query and passage embeddings under different keys', async () => {
    const svc = makeStubbedService('Xenova/bge-base-en-v1.5');
    let callCount = 0;
    // Return orthogonal vectors so query vs passage produce distinct unit vectors
    // even after L2 normalization.
    svc._embedLocal = async () => {
      callCount++;
      return callCount === 1
        ? [1, 0, 0, 0, 0, 0, 0, 0]
        : [0, 1, 0, 0, 0, 0, 0, 0];
    };
    const q = await svc.embed('identical text', { isQuery: true });
    const p = await svc.embed('identical text', { isQuery: false });
    assert.strictEqual(callCount, 2, 'query and passage embeds must not share cache');
    assert.notDeepStrictEqual(q, p);
    // Second call with same isQuery hits cache
    await svc.embed('identical text', { isQuery: true });
    assert.strictEqual(callCount, 2, 'second query call should hit cache');
  });
});

describe('EmbeddingService.embed — Matryoshka truncation', () => {
  it('truncates to targetDimension and re-normalizes', async () => {
    const svc = makeStubbedService('Xenova/nomic-embed-text-v1.5');
    const truncated = await svc.embed('text', { targetDimension: 4 });
    assert.strictEqual(truncated.length, 4);
    // Verify L2 normalized to unit length
    const magnitude = Math.sqrt(truncated.reduce((s: number, v: number) => s + v * v, 0));
    assert.ok(Math.abs(magnitude - 1.0) < 1e-6, `expected unit vector, got magnitude ${magnitude}`);
  });

  it('caches full-dimension vector so subsequent truncations re-use it', async () => {
    let callCount = 0;
    const svc = makeStubbedService('Xenova/nomic-embed-text-v1.5');
    svc._embedLocal = async () => {
      callCount++;
      return [1, 2, 3, 4, 5, 6, 7, 8];
    };
    await svc.embed('text', { targetDimension: 4 });
    await svc.embed('text', { targetDimension: 6 });
    await svc.embed('text'); // full dim
    assert.strictEqual(callCount, 1, 'all three calls should hit cache after first embed');
  });

  it('is a no-op when targetDimension >= embedding length', async () => {
    const svc = makeStubbedService('Xenova/nomic-embed-text-v1.5');
    const full = await svc.embed('text');
    const noopTrunc = await svc.embed('text', { targetDimension: 8 });
    const oversized = await svc.embed('text', { targetDimension: 999 });
    assert.deepStrictEqual(noopTrunc, full);
    assert.deepStrictEqual(oversized, full);
  });
});
