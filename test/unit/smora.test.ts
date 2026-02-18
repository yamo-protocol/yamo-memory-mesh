/**
 * S-MORA (RFC-0012) TDD tests for MemoryMesh.smora()
 * RED phase — written before implementation
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// Helper: wait for async DB to settle
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
    tags: ['#lesson_learned', 'payments'],
  });
  await mesh.add('YAMO kernel heartbeat monitors drift and triggers evolution', {
    type: 'insight',
    tags: ['yamo', 'kernel'],
  });
  await mesh.add('TDD red-green-refactor cycle enforces correctness first', {
    type: 'pattern',
    tags: ['tdd', 'engineering'],
  });
}

describe('RFC-0012 S-MORA: smora() method existence', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(() => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('exposes a smora() method on MemoryMesh', () => {
    assert.strictEqual(typeof (mesh as any).smora, 'function');
  });
});

describe('RFC-0012 S-MORA: basic retrieval', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('returns an SMORAResponse with results array', async () => {
    const resp = await (mesh as any).smora('authentication');
    assert.ok(Array.isArray(resp.results), 'results must be array');
  });

  it('each result has required SMORAResult fields', async () => {
    const resp = await (mesh as any).smora('authentication');
    assert.ok(resp.results.length > 0, 'should have at least 1 result');
    const r = resp.results[0];
    assert.ok('id' in r, 'id required');
    assert.ok('content' in r, 'content required');
    assert.ok('metadata' in r, 'metadata required');
    assert.ok('score' in r, 'score required');
    assert.ok('semanticScore' in r, 'semanticScore required');
    assert.ok('heritageBonus' in r, 'heritageBonus required');
    assert.ok('recencyDecay' in r, 'recencyDecay required');
    assert.ok('rrfRank' in r, 'rrfRank required');
  });

  it('returns pipeline metadata', async () => {
    const resp = await (mesh as any).smora('cache');
    assert.ok(resp.pipeline, 'pipeline field required');
    assert.ok('queryExpanded' in resp.pipeline, 'queryExpanded required');
    assert.ok('heritageAware' in resp.pipeline, 'heritageAware required');
    assert.ok('synthesized' in resp.pipeline, 'synthesized required');
    assert.strictEqual(typeof resp.pipeline.latencyMs, 'number', 'latencyMs must be number');
    assert.ok(resp.pipeline.latencyMs >= 0, 'latencyMs must be non-negative');
  });

  it('score values are between 0 and 1', async () => {
    const resp = await (mesh as any).smora('payment');
    for (const r of resp.results) {
      assert.ok(r.score >= 0 && r.score <= 1, `score out of range: ${r.score}`);
      assert.ok(r.recencyDecay >= 0 && r.recencyDecay <= 1, `recencyDecay out of range: ${r.recencyDecay}`);
      assert.ok(r.heritageBonus >= 0 && r.heritageBonus <= 1, `heritageBonus out of range: ${r.heritageBonus}`);
    }
  });

  it('results are ordered by score descending', async () => {
    const resp = await (mesh as any).smora('engineering patterns');
    const scores = resp.results.map((r: any) => r.score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `not sorted at index ${i}: ${scores[i - 1]} < ${scores[i]}`);
    }
  });

  it('rrfRank values are sequential integers starting at 1', async () => {
    const resp = await (mesh as any).smora('yamo kernel');
    for (let i = 0; i < resp.results.length; i++) {
      assert.strictEqual(resp.results[i].rrfRank, i + 1, `rrfRank should be ${i + 1} at index ${i}`);
    }
  });
});

describe('RFC-0012 S-MORA: limit option', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('respects limit option', async () => {
    const resp = await (mesh as any).smora('authentication', { limit: 2 });
    assert.ok(resp.results.length <= 2, `expected ≤2 results, got ${resp.results.length}`);
  });

  it('defaults to limit=10 when not specified', async () => {
    const resp = await (mesh as any).smora('patterns');
    assert.ok(resp.results.length <= 10, 'should default to 10 max');
  });
});

describe('RFC-0012 S-MORA: HyDE-Lite (Layer 1)', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('pipeline.queryExpanded=true when enableHyDE=true (default)', async () => {
    const resp = await (mesh as any).smora('authentication', { enableHyDE: true });
    assert.strictEqual(resp.pipeline.queryExpanded, true);
  });

  it('pipeline.queryExpanded=false when enableHyDE=false', async () => {
    const resp = await (mesh as any).smora('authentication', { enableHyDE: false });
    assert.strictEqual(resp.pipeline.queryExpanded, false);
  });

  it('returns results even without HyDE (fallback to single-channel semantic)', async () => {
    const resp = await (mesh as any).smora('cache redis', { enableHyDE: false });
    assert.ok(resp.results.length > 0, 'should return results without HyDE');
  });
});

describe('RFC-0012 S-MORA: heritage bonus (Layer 4)', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
    // Add a memory with heritage chain
    const mem = await mesh.add('Heritage memory: JWT auth flow with session management', {
      type: 'insight',
    });
    await mesh.insertHeritage(mem.id, {
      intentChain: ['plan_auth', 'execute_auth'],
      hypotheses: ['hypothesis X'],
      rationales: ['rationale Y'],
    });
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('pipeline.heritageAware=true when sessionIntent provided', async () => {
    const resp = await (mesh as any).smora('authentication', {
      sessionIntent: ['plan_auth', 'execute_auth'],
    });
    assert.strictEqual(resp.pipeline.heritageAware, true);
  });

  it('pipeline.heritageAware=false when no sessionIntent', async () => {
    const resp = await (mesh as any).smora('authentication');
    assert.strictEqual(resp.pipeline.heritageAware, false);
  });

  it('memory with matching heritage chain gets heritageBonus > 0', async () => {
    const resp = await (mesh as any).smora('JWT auth session', {
      sessionIntent: ['plan_auth', 'execute_auth'],
    });
    const withHeritage = resp.results.find((r: any) => r.heritageBonus > 0);
    assert.ok(withHeritage, 'at least one result should have heritageBonus > 0');
  });

  it('heritageBonus=0 when sessionIntent is empty/absent', async () => {
    const resp = await (mesh as any).smora('authentication');
    for (const r of resp.results) {
      assert.strictEqual(r.heritageBonus, 0, `expected heritageBonus=0, got ${r.heritageBonus}`);
    }
  });
});

describe('RFC-0012 S-MORA: synthesis disabled (Layer 5)', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('pipeline.synthesized=false when enableSynthesis=false (default)', async () => {
    const resp = await (mesh as any).smora('patterns');
    assert.strictEqual(resp.pipeline.synthesized, false);
  });

  it('synthesis field is undefined when synthesis disabled', async () => {
    const resp = await (mesh as any).smora('patterns');
    assert.strictEqual(resp.synthesis, undefined);
  });

  it('pipeline.synthesized=false when LLM unavailable even if enableSynthesis=true', async () => {
    // LLM is disabled in this mesh, so synthesis should be skipped gracefully
    const resp = await (mesh as any).smora('patterns', { enableSynthesis: true });
    assert.strictEqual(resp.pipeline.synthesized, false);
  });
});

describe('RFC-0012 S-MORA: recency decay', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await seedMemories(mesh);
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('recent memories have recencyDecay close to 1.0', async () => {
    // Seeded memories are just-created, so age_days ≈ 0 → exp(0) = 1.0
    const resp = await (mesh as any).smora('authentication');
    for (const r of resp.results) {
      assert.ok(r.recencyDecay > 0.95, `recencyDecay should be ~1.0 for new memory, got ${r.recencyDecay}`);
    }
  });
});

describe('RFC-0012 S-MORA: empty corpus', () => {
  let mesh: InstanceType<typeof MemoryMesh>;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
  });

  after(async () => {
    if ((mesh as any).isInitialized) await mesh.close();
  });

  it('returns empty results array on empty corpus', async () => {
    const resp = await (mesh as any).smora('anything');
    assert.ok(Array.isArray(resp.results), 'results must be array');
    assert.strictEqual(resp.results.length, 0, 'no results in empty corpus');
  });

  it('still returns valid pipeline metadata on empty corpus', async () => {
    const resp = await (mesh as any).smora('anything');
    assert.ok(resp.pipeline, 'pipeline required');
    assert.ok(typeof resp.pipeline.latencyMs === 'number', 'latencyMs required');
  });
});
