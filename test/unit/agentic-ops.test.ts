/**
 * Tests for agentic memory write ops (Mem0 / A-MEM / Letta pattern).
 *
 * Validates the four decisions (ADD / UPDATE / MERGE / NOOP) plus the
 * gating logic — agentic judge only runs in the gray similarity zone and
 * only when enableAgenticOps is opted in.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

/**
 * Stub mesh with controllable nearest-neighbor + add tracking. Same shape
 * as dedup-similarity tests so behavior is comparable.
 */
function makeStubMesh(opts: {
  nearestDistance?: number;
  nearestContent?: string;
  nearestId?: string;
  enableAgenticOps?: boolean;
} = {}) {
  const mesh: any = new MemoryMesh({
    dbDir: ':memory:',
    enableYamo: false,
    enableLLM: true,
    enableAgenticOps: opts.enableAgenticOps ?? true,
  });
  mesh.isInitialized = true;
  let addCallCount = 0;
  let lastAddedRecord: any = null;
  let embedCallCount = 0;
  mesh.client = {
    search: async () => {
      if (opts.nearestContent === undefined) return [];
      return [
        {
          id: opts.nearestId ?? 'mem_existing',
          content: opts.nearestContent,
          metadata: {},
          score: opts.nearestDistance ?? 0.5,
        },
      ];
    },
    add: async (record: any) => {
      addCallCount++;
      lastAddedRecord = record;
      return { ...record };
    },
    update: async () => {},
    getWhere: async () => [],
  };
  mesh.embeddingFactory = {
    configured: true,
    embed: async () => {
      embedCallCount++;
      return new Array(384).fill(0.1);
    },
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
  return {
    mesh,
    getAddCount: () => addCallCount,
    getLastAdded: () => lastAddedRecord,
    getEmbedCount: () => embedCallCount,
  };
}

describe('MemoryMesh.add — agentic memory ops', () => {
  afterEach(() => {
    delete process.env.AGENTIC_OPS_GRAY_ZONE_MIN;
    delete process.env.AGENTIC_OPS_TIMEOUT_MS;
  });

  it('does not invoke judge when enableAgenticOps is false (default)', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'related but not identical fact',
      nearestDistance: 0.4, // similarity 0.80 — gray zone if enabled
      enableAgenticOps: false,
    });
    let judgeCalls = 0;
    mesh.llmClient.complete = async () => {
      judgeCalls++;
      return '{"decision":"NOOP"}';
    };
    const result = await mesh.add('a related fact');
    assert.strictEqual(judgeCalls, 0, 'judge must not be called when agentic ops disabled');
    assert.strictEqual(getAddCount(), 1, 'should plain-ADD when agentic ops disabled');
    assert.ok(result.id.startsWith('mem_'));
  });

  it('skips judge when similarity is below the gray zone (clearly distinct)', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'totally unrelated existing fact',
      nearestDistance: 0.9, // similarity 0.55 — below gray zone min 0.70
    });
    let judgeCalls = 0;
    mesh.llmClient.complete = async () => {
      judgeCalls++;
      return '{"decision":"NOOP"}';
    };
    await mesh.add('new distinct fact');
    assert.strictEqual(judgeCalls, 0);
    assert.strictEqual(getAddCount(), 1);
  });

  it('NOOP: short-circuits to existing neighbor id, no insert', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'existing fact about JWT',
      nearestDistance: 0.3, // similarity 0.85 — gray zone
      nearestId: 'mem_existing_jwt',
    });
    mesh.llmClient.complete = async () =>
      '{"decision":"NOOP","rationale":"redundant"}';
    const result = await mesh.add('JWT fact restated');
    assert.strictEqual(result.id, 'mem_existing_jwt');
    assert.strictEqual(getAddCount(), 0);
  });

  it('UPDATE: inserts new memory with replaces_memory_id set to neighbor', async () => {
    const { mesh, getAddCount, getLastAdded } = makeStubMesh({
      nearestContent: 'old version of fact',
      nearestDistance: 0.3,
      nearestId: 'mem_old_version',
    });
    mesh.llmClient.complete = async () =>
      '{"decision":"UPDATE","rationale":"newer info"}';
    const result = await mesh.add('updated version of fact');
    assert.strictEqual(getAddCount(), 1);
    assert.ok(result.id.startsWith('mem_'));
    const meta = JSON.parse(getLastAdded().metadata);
    assert.strictEqual(meta.replaces_memory_id, 'mem_old_version');
  });

  it('MERGE: rewrites content, re-embeds, sets replaces_memory_id', async () => {
    const { mesh, getAddCount, getLastAdded, getEmbedCount } = makeStubMesh({
      nearestContent: 'fact A',
      nearestDistance: 0.3,
      nearestId: 'mem_a',
    });
    mesh.llmClient.complete = async () =>
      '{"decision":"MERGE","merged_content":"combined fact A + B","rationale":"complementary"}';
    const result = await mesh.add('fact B');
    assert.strictEqual(getAddCount(), 1);
    const added = getLastAdded();
    assert.strictEqual(added.content, 'combined fact A + B');
    const meta = JSON.parse(added.metadata);
    assert.strictEqual(meta.replaces_memory_id, 'mem_a');
    // 2 embeds: once for the original content, once for merged content
    assert.strictEqual(getEmbedCount(), 2);
    assert.ok(result.id.startsWith('mem_'));
  });

  it('ADD: falls through to plain insert (no supersession)', async () => {
    const { mesh, getAddCount, getLastAdded } = makeStubMesh({
      nearestContent: 'related fact A',
      nearestDistance: 0.3,
      nearestId: 'mem_a',
    });
    mesh.llmClient.complete = async () =>
      '{"decision":"ADD","rationale":"new info"}';
    await mesh.add('related but new fact B');
    assert.strictEqual(getAddCount(), 1);
    const meta = JSON.parse(getLastAdded().metadata);
    assert.strictEqual(meta.replaces_memory_id, undefined, 'ADD must not set replaces_memory_id');
  });

  it('falls back to ADD when LLM throws', async () => {
    const { mesh, getAddCount, getLastAdded } = makeStubMesh({
      nearestContent: 'existing',
      nearestDistance: 0.3,
    });
    mesh.llmClient.complete = async () => {
      throw new Error('LLM down');
    };
    await mesh.add('new fact');
    assert.strictEqual(getAddCount(), 1);
    const meta = JSON.parse(getLastAdded().metadata);
    assert.strictEqual(meta.replaces_memory_id, undefined);
  });

  it('falls back to ADD when LLM returns malformed JSON', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'existing',
      nearestDistance: 0.3,
    });
    mesh.llmClient.complete = async () => 'not valid json {{{ broken';
    await mesh.add('new fact');
    assert.strictEqual(getAddCount(), 1);
  });

  it('falls back to ADD when LLM returns unknown decision', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'existing',
      nearestDistance: 0.3,
    });
    mesh.llmClient.complete = async () => '{"decision":"DELETE_ALL_THE_THINGS"}';
    await mesh.add('new fact');
    assert.strictEqual(getAddCount(), 1);
  });

  it('falls back to ADD when MERGE response lacks merged_content', async () => {
    const { mesh, getAddCount, getLastAdded } = makeStubMesh({
      nearestContent: 'existing',
      nearestDistance: 0.3,
      nearestId: 'mem_e',
    });
    mesh.llmClient.complete = async () =>
      '{"decision":"MERGE","rationale":"missing merged_content"}';
    await mesh.add('candidate');
    assert.strictEqual(getAddCount(), 1);
    const added = getLastAdded();
    assert.strictEqual(added.content, 'candidate', 'must keep original content if merge unusable');
    const meta = JSON.parse(added.metadata);
    assert.strictEqual(meta.replaces_memory_id, undefined);
  });

  it('falls back to ADD on judge timeout', async () => {
    process.env.AGENTIC_OPS_TIMEOUT_MS = '50';
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'existing',
      nearestDistance: 0.3,
    });
    mesh.llmClient.complete = () =>
      new Promise((resolve) => setTimeout(() => resolve('{"decision":"NOOP"}'), 500));
    const t0 = Date.now();
    await mesh.add('new fact');
    const elapsed = Date.now() - t0;
    assert.strictEqual(getAddCount(), 1);
    assert.ok(elapsed < 400, `expected fast timeout fallback, took ${elapsed}ms`);
  });

  it('still dedups on similarity >= threshold even with agentic ops enabled', async () => {
    const { mesh, getAddCount } = makeStubMesh({
      nearestContent: 'near-duplicate content',
      nearestDistance: 0.05, // similarity 0.975 — above 0.95 dedup threshold
      nearestId: 'mem_dup',
    });
    let judgeCalls = 0;
    mesh.llmClient.complete = async () => {
      judgeCalls++;
      return '{"decision":"ADD"}';
    };
    const result = await mesh.add('near-duplicate content variant');
    assert.strictEqual(result.id, 'mem_dup', 'dedup must win over judge');
    assert.strictEqual(getAddCount(), 0);
    assert.strictEqual(judgeCalls, 0, 'judge must not be called when dedup fires');
  });
});
