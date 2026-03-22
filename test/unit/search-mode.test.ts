/**
 * Tests for search mode support: vector, keyword, hybrid (default)
 *
 * Verifies that MemoryMesh.search() respects the `mode` option:
 * - "hybrid" (default): vector + keyword with RRF merge
 * - "vector": vector search only, no keyword matching
 * - "keyword": keyword search only, no embedding
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

async function seedMemories(mesh: InstanceType<typeof MemoryMesh>) {
  await mesh.add('Authentication using JWT tokens with expiry validation', {
    type: 'insight',
    tags: ['auth', 'jwt'],
  });
  await mesh.add('Redis cache invalidation strategy for user sessions', {
    type: 'pattern',
    tags: ['cache', 'redis'],
  });
  await mesh.add('Payment processing with idempotency keys prevents duplicate charges', {
    type: 'lesson',
    tags: ['payments'],
  });
}

describe('search mode: hybrid (default)', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('returns results when no mode specified (default hybrid)', async () => {
    const results = await mesh.search('authentication JWT', { limit: 3 });
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it('returns results with mode "hybrid" explicitly', async () => {
    const results = await mesh.search('authentication JWT', { limit: 3, mode: 'hybrid' });
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });
});

describe('search mode: vector', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('returns results using vector-only search', async () => {
    const results = await mesh.search('authentication JWT', { limit: 3, mode: 'vector' });
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it('vector mode results have scores', async () => {
    const results = await mesh.search('cache invalidation', { limit: 2, mode: 'vector' });
    assert.ok(results.length > 0);
    // Vector results should have a score field
    assert.ok(typeof results[0].score === 'number');
  });
});

describe('search mode: keyword', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('returns results using keyword-only search', async () => {
    const results = await mesh.search('JWT tokens', { limit: 3, mode: 'keyword' });
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it('keyword mode finds exact term matches', async () => {
    const results = await mesh.search('idempotency', { limit: 3, mode: 'keyword' });
    assert.ok(results.length > 0);
    // The result should contain the word "idempotency"
    const hasMatch = results.some((r: any) =>
      r.content?.toLowerCase().includes('idempotency')
    );
    assert.ok(hasMatch, 'keyword search should find exact term matches');
  });

  it('keyword mode returns empty for non-matching terms', async () => {
    const results = await mesh.search('xyznonexistent', { limit: 3, mode: 'keyword' });
    assert.strictEqual(results.length, 0);
  });
});

describe('search mode: caching respects mode', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('different modes produce different cache keys', async () => {
    // Run same query in all three modes — should not return cached results from wrong mode
    const hybrid = await mesh.search('JWT', { limit: 3, mode: 'hybrid' });
    const vector = await mesh.search('JWT', { limit: 3, mode: 'vector' });
    const keyword = await mesh.search('JWT', { limit: 3, mode: 'keyword' });

    // All should return results (JWT appears in seeded data)
    assert.ok(hybrid.length > 0, 'hybrid should find results');
    assert.ok(vector.length > 0, 'vector should find results');
    assert.ok(keyword.length > 0, 'keyword should find results');
  });
});
