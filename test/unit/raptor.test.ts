/**
 * Tests for RAPTOR-style hierarchical summarization in MemoryMesh.
 *
 * Validates:
 * - Tree builds across multiple levels
 * - Cluster summaries are stored with type=summary_l{N} + source_memory_ids
 * - Singleton clusters pass through without an LLM call
 * - Final root collapses when layer ≤ branchingFactor
 * - LLM-disabled is a clean no-op (returns zeros)
 * - K-means produces correct number of clusters
 * - Empty corpus → no-op
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

const dim = 8;
function makeVec(seed: number): number[] {
  // Generate a deterministic L2-normalized vector seeded from `seed`.
  const v = new Array(dim).fill(0).map((_, i) => Math.sin(seed * 7.13 + i * 1.31));
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / mag);
}

describe('MemoryMesh._kmeansClusters', () => {
  it('returns singleton clusters when k >= items.length', () => {
    const mesh: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    const items = [
      { id: 'a', content: 'x', vector: makeVec(1) },
      { id: 'b', content: 'y', vector: makeVec(2) },
    ];
    const clusters = mesh._kmeansClusters(items, 5);
    assert.strictEqual(clusters.length, 2);
    assert.strictEqual(clusters[0].length, 1);
  });

  it('partitions items into k clusters (k < n)', () => {
    const mesh: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      content: `content-${i}`,
      vector: makeVec(i),
    }));
    const clusters = mesh._kmeansClusters(items, 3);
    assert.ok(clusters.length <= 3, `expected ≤3 clusters, got ${clusters.length}`);
    const total = clusters.reduce((s: number, c: any[]) => s + c.length, 0);
    assert.strictEqual(total, 10, 'all items must be assigned to exactly one cluster');
  });

  it('returns empty for empty input', () => {
    const mesh: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    assert.deepStrictEqual(mesh._kmeansClusters([], 3), []);
  });
});

describe('MemoryMesh.raptor — integration', () => {
  let mesh: any;

  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('returns zeros when LLM is disabled', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    await mesh.add('memory 1');
    await mesh.add('memory 2');
    const result = await mesh.raptor({});
    assert.strictEqual(result.levelsBuilt, 0);
    assert.strictEqual(result.summariesCreated, 0);
  });

  it('returns zeros on empty corpus', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    await mesh.init();
    let llmCalls = 0;
    mesh.llmClient.complete = async () => {
      llmCalls++;
      return 'summary';
    };
    const result = await mesh.raptor({});
    assert.strictEqual(result.summariesCreated, 0);
    assert.strictEqual(llmCalls, 0, 'must not call LLM on empty corpus');
  });

  it('builds a single root when layer size ≤ branchingFactor', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    await mesh.init();
    for (let i = 0; i < 4; i++) {
      await mesh.add(`memory entry ${i} discussing topic A`);
    }
    // Count only summarization prompts; storing the summary also issues an
    // LLM call for Graph-RAG triple extraction inside mesh.add() which we
    // don't care about for this assertion.
    let summarizeCalls = 0;
    mesh.llmClient.complete = async (systemPrompt: string) => {
      if (systemPrompt.includes('summarization agent')) summarizeCalls++;
      return `Root summary covering memories.`;
    };
    const result = await mesh.raptor({ branchingFactor: 5 });
    // 4 ≤ 5 → straight to root summary
    assert.strictEqual(result.levelsBuilt, 1);
    assert.strictEqual(result.summariesCreated, 1);
    assert.strictEqual(result.perLevel[0].clusters, 1);
    assert.ok(result.treeRootId);
    assert.strictEqual(summarizeCalls, 1, 'one summarization call for the root');
  });

  it('clusters and summarizes when layer size > branchingFactor', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    await mesh.init();
    for (let i = 0; i < 12; i++) {
      await mesh.add(`memory entry number ${i}`);
    }
    mesh.llmClient.complete = async () => 'Cluster summary.';
    const result = await mesh.raptor({ branchingFactor: 4, maxLevels: 3 });
    // 12 leaves, branching 4 → k = ceil(12/4) = 3 clusters at L1
    // L1 has up to 3 summaries; if ≤ 4 they become the root at L2.
    assert.ok(result.levelsBuilt >= 1, 'expected at least one level built');
    assert.ok(result.summariesCreated >= 1);
    assert.strictEqual(result.perLevel[0].level, 1);
  });

  it('stores summaries with type=summary_l{N} and source_memory_ids', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    await mesh.init();
    const leafIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const m = await mesh.add(`leaf memory ${i}`);
      leafIds.push(m.id);
    }
    mesh.llmClient.complete = async () => 'Synthesized summary of all 4 leaves.';
    const result = await mesh.raptor({ branchingFactor: 5 });
    assert.ok(result.treeRootId);
    const summary = await mesh.get(result.treeRootId!);
    assert.ok(summary);
    const meta = typeof summary!.metadata === 'string' ? JSON.parse(summary!.metadata) : summary!.metadata;
    assert.strictEqual(meta.type, 'summary_l1');
    assert.strictEqual(meta.generated_by, 'raptor');
    assert.ok(Array.isArray(meta.source_memory_ids));
    // All 4 leaf ids must be referenced
    for (const id of leafIds) {
      assert.ok(meta.source_memory_ids.includes(id), `source_memory_ids missing ${id}`);
    }
  });

  it('singleton cluster passes through without an LLM call', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    await mesh.init();
    // Single memory → cluster of size 1 → passthrough, no LLM
    await mesh.add('lone memory');
    let llmCalls = 0;
    mesh.llmClient.complete = async () => {
      llmCalls++;
      return 'should not be called';
    };
    const result = await mesh.raptor({ branchingFactor: 5 });
    assert.strictEqual(llmCalls, 0, 'singleton must not invoke LLM');
    assert.strictEqual(result.levelsBuilt, 1);
    assert.strictEqual(result.summariesCreated, 1);
  });

  it('skips dedup when storing summaries (avoids collapse against leaves)', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    await mesh.init();
    // Seed near-duplicate-ish memories so summary text might collide
    for (let i = 0; i < 4; i++) {
      await mesh.add(`The system handles JWT validation with key rotation at the edge.`);
    }
    // The dedup pass on add() would normally collapse these 4 to 1, but each
    // add still returns an id. RAPTOR's summary then must NOT dedup against
    // them either.
    mesh.llmClient.complete = async () => 'JWT validation handled with key rotation at the edge.';
    const result = await mesh.raptor({ branchingFactor: 5 });
    if (result.treeRootId) {
      const summary = await mesh.get(result.treeRootId);
      assert.ok(summary, 'summary should be stored even when content is similar to leaves');
    }
  });
});
