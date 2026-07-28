import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// mesh doctor / stale / orphans (workspace-g9p.6). Non-mutating hygiene
// checks against a real temp LanceDB.
describe('MemoryMesh doctor', () => {
  const savedUri = process.env.LANCEDB_URI;

  before(() => {
    // The config-mismatch check reads LANCEDB_URI; keep the baseline clean.
    delete process.env.LANCEDB_URI;
  });

  after(() => {
    if (savedUri !== undefined) process.env.LANCEDB_URI = savedUri;
  });

  it('reports ok on a healthy store', async () => {
    const mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
    await mesh.add('healthy store fixture row', { type: 'note', skipDedup: true });
    const result = await mesh.doctor();
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
    assert.ok(result.checks.some((c: any) => c.name === 'database' && c.ok));
  });

  it('flags dangling decision edges', async () => {
    const mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
    await mesh._writeDecisionEdges('ghost_source', { depends_on: ['ghost_target'], reasoning: 'seeded' }, []);
    const orphans = await mesh.orphanEdges();
    assert.ok(orphans.length >= 1, 'orphan edge listed');
    assert.ok(orphans[0].missing.includes('ghost_target'));
    const result = await mesh.doctor();
    const check = result.checks.find((c: any) => c.name === 'dangling-decision-edges');
    assert.ok(check && !check.ok, 'dangling edge check fails');
    assert.equal(result.ok, false, 'overall not ok');
  });

  it('flags a dbDir that disagrees with LANCEDB_URI', async () => {
    const mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
    // The :memory: sentinel resolves to a temp dir; point dbDir somewhere real
    // and the env somewhere else to simulate the live-vs-repo footgun.
    mesh.dbDir = '/tmp/mesh-doctor-a';
    process.env.LANCEDB_URI = '/tmp/mesh-doctor-b';
    try {
      const result = await mesh.doctor();
      const check = result.checks.find((c: any) => c.name === 'config-mismatch');
      assert.ok(check, 'mismatch check ran');
      assert.equal(check.ok, false, 'mismatch flagged');
    } finally {
      delete process.env.LANCEDB_URI;
    }
  });

  it('flags a table past the index threshold without a vector index', async () => {
    const mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
    await mesh.add('index threshold row one about ceramic bearings', { type: 'note', skipDedup: true });
    await mesh.add('index threshold row two about polymer seals', { type: 'note', skipDedup: true });
    const result = await mesh.doctor({ indexThreshold: 1 });
    const check = result.checks.find((c: any) => c.name === 'vector-index');
    assert.ok(check, 'vector index check ran');
    assert.equal(check.ok, false, 'unindexed table past threshold flagged');
  });

  it('stale report lists untouched rows without mutating anything', async () => {
    const mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
    const m = await mesh.add('stale probe row about legacy fixtures', { type: 'note', skipDedup: true });
    // days: -1 puts the cutoff in the future, so even a fresh row qualifies.
    const stale = await mesh.staleMemoriesReport({ days: -1 });
    assert.ok(stale.some((s: any) => s.id === m.id), 'fresh row reported under future cutoff');
    const rec = await mesh.client.getById(m.id);
    assert.equal(rec.state, 'active', 'report did not mutate state');
  });
});
