/**
 * Tests for query cache invalidation on writes (workspace-iqu).
 *
 * Before the fix: a search() within the 5-min cache TTL after a write
 * would return stale results that didn't include the new record. These
 * tests would fail on the old code (the second search returned cached
 * results from before the write).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('MemoryMesh — query cache invalidation', () => {
  let mesh: any;
  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('add() clears the query cache so subsequent search sees the new record', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    await mesh.add('JWT tokens carry expiration claims');
    // Prime the cache with a search
    const first = await mesh.search('JWT', { limit: 5 });
    assert.strictEqual(first.length, 1);
    assert.ok(mesh.queryCache.size > 0, 'cache should have an entry after first search');

    // Insert a second record that matches the same query
    await mesh.add('JWT signing uses HMAC-SHA256');

    // Cache must be cleared so this search picks up the new record
    assert.strictEqual(mesh.queryCache.size, 0, 'add() must clear queryCache');
    const second = await mesh.search('JWT', { limit: 5 });
    assert.strictEqual(second.length, 2, 'second search should include the newly-added record');
  });

  it('delete() clears the query cache so subsequent search excludes the removed record', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    const m1 = await mesh.add('Redis cache invalidation patterns');
    await mesh.add('Redis pipelining for throughput');
    const first = await mesh.search('Redis', { limit: 5 });
    assert.strictEqual(first.length, 2);
    assert.ok(mesh.queryCache.size > 0);

    await mesh.delete(m1.id);
    assert.strictEqual(mesh.queryCache.size, 0, 'delete() must clear queryCache');

    const second = await mesh.search('Redis', { limit: 5 });
    assert.strictEqual(second.length, 1, 'second search must not return the deleted record');
    assert.notStrictEqual(second[0].id, m1.id);
  });

  it('dedup short-circuit does not invalidate cache (no new record was stored)', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    await mesh.add('payment idempotency keys prevent duplicate charges');
    await mesh.search('payment', { limit: 5 });
    const sizeBeforeDup = mesh.queryCache.size;
    assert.ok(sizeBeforeDup > 0);

    // Adding the exact same content triggers dedup short-circuit;
    // the existing entry is returned, no new record is written, so the
    // cache stays intact. (If we cleared here too it'd just be slower.)
    await mesh.add('payment idempotency keys prevent duplicate charges');
    assert.strictEqual(mesh.queryCache.size, sizeBeforeDup, 'dedup-only path should leave cache intact');
  });

  it('addDocument() clears cache after the late-chunk direct-write path', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    await mesh.add('seed memory unrelated topic');
    await mesh.search('seed', { limit: 5 });
    assert.ok(mesh.queryCache.size > 0);

    // Stub late-chunked path so we exercise the direct client.add branch
    mesh.embeddingFactory.embedLateChunked = async (_text: string, spans: any[]) => {
      return spans.map((_, i) => {
        const v = new Array(384).fill(0);
        v[i % 384] = 1;
        return v;
      });
    };
    const text = 'P1 '.repeat(120) + '\n\n' + 'P2 '.repeat(120);
    await mesh.addDocument(text, {}, { minChunkChars: 100, maxChunkChars: 300 });
    assert.strictEqual(mesh.queryCache.size, 0, 'addDocument late-chunk path must clear cache');
  });
});
