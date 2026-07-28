import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// Lifecycle states + defer_until (workspace-g9p.5) and pinned/prime
// (workspace-g9p.1). Real temp LanceDB (dbDir ':memory:' maps to an isolated
// tmp dir) — no mocks, per the dispatch-persistence lesson.
describe('MemoryMesh lifecycle + prime', () => {
  let mesh: any;

  before(async () => {
    mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
  });

  it('new rows are born active, unpinned, undeferred', async () => {
    const m = await mesh.add('the quick brown fox jumps over the lazy dog', { type: 'note', skipDedup: true });
    const rec = await mesh.client.getById(m.id);
    assert.equal(rec.state, 'active');
    assert.equal(rec.pinned, false);
    assert.equal(rec.defer_until, null);
  });

  it('archived rows leave default search but stay reachable with includeArchived', async () => {
    const m = await mesh.add('zebra stripes exhibit unique identification patterns', { type: 'note', skipDedup: true });
    const before_ = await mesh.search('zebra stripes patterns', { mode: 'vector', useCache: false });
    assert.ok(before_.some((r: any) => r.id === m.id), 'visible before archiving');

    const res = await mesh.setState(m.id, 'archived');
    assert.equal(res.previous, 'active');

    const after = await mesh.search('zebra stripes patterns', { mode: 'vector', useCache: false });
    assert.ok(!after.some((r: any) => r.id === m.id), 'hidden after archiving');

    const opted = await mesh.search('zebra stripes patterns', { mode: 'vector', useCache: false, includeArchived: true });
    assert.ok(opted.some((r: any) => r.id === m.id), 'reachable with includeArchived');
  });

  it('setState rejects values outside the vocabulary', async () => {
    const m = await mesh.add('vocabulary guard test row', { type: 'note', skipDedup: true });
    await assert.rejects(() => mesh.setState(m.id, 'bogus'), /invalid state/);
  });

  it('deferMemory suppresses until due, then the row surfaces again', async () => {
    const m = await mesh.add('cobalt widget calibration requires a torque wrench', { type: 'note', skipDedup: true });
    await mesh.deferMemory(m.id, new Date(Date.now() + 60 * 60 * 1000));
    const hidden = await mesh.search('cobalt widget calibration', { mode: 'vector', useCache: false });
    assert.ok(!hidden.some((r: any) => r.id === m.id), 'deferred row hidden');

    await mesh.deferMemory(m.id, new Date(Date.now() - 1000));
    const visible = await mesh.search('cobalt widget calibration', { mode: 'vector', useCache: false });
    assert.ok(visible.some((r: any) => r.id === m.id), 'due row surfaces');
  });

  it('belief revision by key sets state=superseded alongside superseded_at', async () => {
    const first = await mesh.add('the deploy target is staging cluster one', { type: 'decision', key: 'lifecycle-deploy-target', skipDedup: true });
    await mesh.add('the deploy target is production cluster nine', { type: 'decision', key: 'lifecycle-deploy-target', skipDedup: true });
    const rec = await mesh.client.getById(first.id);
    assert.ok(rec.superseded_at, 'superseded_at stamped');
    assert.equal(rec.state, 'superseded');
  });

  it('prime surfaces pinned memories regardless of query similarity', async () => {
    const pinnedMem = await mesh.add('never run bd dolt push on this workspace', { type: 'lesson', key: 'prime-pin-key', skipDedup: true });
    await mesh.pin('prime-pin-key'); // resolve by key, not id
    const dueMem = await mesh.add('revisit the quarterly capacity plan', { type: 'note', skipDedup: true });
    await mesh.deferMemory(dueMem.id, new Date(Date.now() - 1000)); // already due

    const out = await mesh.prime('entirely unrelated quantum blockchain telemetry');
    assert.ok(out.pinned.some((p: any) => p.id === pinnedMem.id), 'pinned appears despite zero similarity');
    assert.ok(out.due.some((d: any) => d.id === dueMem.id), 'due deferred row appears');

    const unpinned = await mesh.unpin(pinnedMem.id);
    assert.equal(unpinned.pinned, false);
    const out2 = await mesh.prime();
    assert.ok(!out2.pinned.some((p: any) => p.id === pinnedMem.id), 'unpinned row leaves prime');
  });

  it('prime contextual section respects search ranking for a query', async () => {
    const m = await mesh.add('osmium density measurements from the alloy lab', { type: 'note', skipDedup: true });
    const out = await mesh.prime('osmium density alloy', { limit: 5 });
    assert.ok(out.contextual.some((c: any) => c.id === m.id), 'relevant unpinned memory in contextual');
  });
});
