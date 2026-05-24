/**
 * Tests for similarity-threshold dedup in MemoryMesh.add().
 *
 * Validates:
 * - Exact string match → returns existing id (preserved behavior)
 * - Near-duplicate (similarity >= threshold) → returns existing id
 * - Distinct content (similarity < threshold) → creates new memory
 * - Opt-out via metadata.skipDedup → always creates new memory
 * - Bypassed when metadata.key is set (defers to belief-revision path)
 * - Bypassed when metadata.replaces_memory_id is set
 * - Threshold configurable via DEDUP_SIMILARITY_THRESHOLD env
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

/**
 * Builds a mesh with fully-stubbed dependencies so we can control the
 * nearest-neighbor distance returned by client.search() and assert which
 * write path (dedup short-circuit vs full insert) is taken.
 */
function makeStubMesh(opts: {
  nearestDistance?: number; // LanceDB cosine _distance, range [0, 2]
  nearestContent?: string;
  nearestId?: string;
} = {}) {
  const mesh: any = new MemoryMesh({
    dbDir: ':memory:',
    enableYamo: false,
    enableLLM: false,
  });
  // Skip real init — wire stubs directly
  mesh.isInitialized = true;
  let addCallCount = 0;
  mesh.client = {
    search: async () => {
      if (opts.nearestContent === undefined) return [];
      return [
        {
          id: opts.nearestId ?? 'existing-id',
          content: opts.nearestContent,
          metadata: {},
          score: opts.nearestDistance ?? 0.0,
        },
      ];
    },
    add: async (record: any) => {
      addCallCount++;
      return { ...record, metadata: record.metadata };
    },
    update: async () => {},
    getWhere: async () => [],
  };
  mesh.embeddingFactory = {
    configured: true,
    embed: async () => new Array(384).fill(0.1),
  };
  mesh.scrubber = {
    process: async (input: { content: string }) => ({
      success: true,
      chunks: [{ text: input.content }],
      metadata: {},
      telemetry: {},
    }),
  };
  mesh.keywordSearch = { add: () => {}, remove: () => {} };
  return { mesh, getAddCount: () => addCallCount };
}

describe('MemoryMesh.add — similarity-threshold dedup', () => {
  afterEach(() => {
    delete process.env.DEDUP_SIMILARITY_THRESHOLD;
  });

  it('returns existing id on exact string match', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'identical content',
      nearestDistance: 0.0,
      nearestId: 'mem_existing',
    });
    const result = await mesh.add('identical content');
    assert.strictEqual(result.id, 'mem_existing');
    assert.strictEqual(getAddCount(), 0, 'should not insert when exact match');
  });

  it('returns existing id on near-duplicate (similarity >= 0.95)', async () => {
    // distance 0.08 → similarity 0.96, above default 0.95 threshold
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'JWT tokens carry expiration',
      nearestDistance: 0.08,
      nearestId: 'mem_near',
    });
    const result = await mesh.add('JWT tokens carry expiration claims'); // slight variant
    assert.strictEqual(result.id, 'mem_near');
    assert.strictEqual(getAddCount(), 0);
  });

  it('creates new memory when similarity below threshold', async () => {
    // distance 0.30 → similarity 0.85, below default 0.95 threshold
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'JWT tokens carry expiration',
      nearestDistance: 0.30,
      nearestId: 'mem_distant',
    });
    const result = await mesh.add('Redis caching pattern with TTL');
    assert.notStrictEqual(result.id, 'mem_distant');
    assert.strictEqual(getAddCount(), 1);
  });

  it('honors DEDUP_SIMILARITY_THRESHOLD env override', async () => {
    process.env.DEDUP_SIMILARITY_THRESHOLD = '0.80';
    // distance 0.30 → similarity 0.85, now above 0.80 threshold
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'something similar enough',
      nearestDistance: 0.30,
      nearestId: 'mem_t80',
    });
    const result = await mesh.add('related content');
    assert.strictEqual(result.id, 'mem_t80');
    assert.strictEqual(getAddCount(), 0);
  });

  it('skips dedup when metadata.key is set (defers to belief-revision)', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'old contract address',
      nearestDistance: 0.0, // would normally trigger dedup
      nearestId: 'mem_old',
    });
    const result = await mesh.add('old contract address', { key: 'contract' });
    assert.notStrictEqual(result.id, 'mem_old', 'must create new record for key-versioned add');
    assert.strictEqual(getAddCount(), 1);
  });

  it('skips dedup when metadata.replaces_memory_id is set', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'previous fact',
      nearestDistance: 0.0,
      nearestId: 'mem_prev',
    });
    const result = await mesh.add('previous fact', { replaces_memory_id: 'mem_prev' });
    assert.notStrictEqual(result.id, 'mem_prev');
    assert.strictEqual(getAddCount(), 1);
  });

  it('skips dedup when metadata.lesson_pattern_id is set (RFC-0011 lessons)', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: '[LESSON:abc] Fallback flag enabled | Rule: never enable',
      nearestDistance: 0.0,
      nearestId: 'mem_lesson_abc',
    });
    const result = await mesh.add('[LESSON:def] Fallback flag enabled | Rule: never enable', {
      type: 'lesson',
      lesson_pattern_id: 'def',
    });
    assert.notStrictEqual(result.id, 'mem_lesson_abc', 'each lesson pattern must produce its own memory');
    assert.strictEqual(getAddCount(), 1);
  });

  it('skips dedup when metadata.skipDedup=true', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'identical content',
      nearestDistance: 0.0,
      nearestId: 'mem_id',
    });
    const result = await mesh.add('identical content', { skipDedup: true });
    assert.notStrictEqual(result.id, 'mem_id');
    assert.strictEqual(getAddCount(), 1);
  });

  it('creates new memory when no nearest neighbor exists', async () => {
    const { mesh, getAddCount } = makeStubMesh({}); // empty corpus
    const result = await mesh.add('first memory ever');
    assert.ok(result.id);
    assert.strictEqual(getAddCount(), 1);
  });
});
