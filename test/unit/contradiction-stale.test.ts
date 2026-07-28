import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// Actionable decision edges (workspace-g9p.4): contradiction-aware ranking
// and the stale-beliefs report. Decision edges are written fire-and-forget by
// add(), so tests poll decisionLineage until they land.
async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  let last: T;
  do {
    last = await fn();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < deadline);
  return last;
}

describe('MemoryMesh contradiction penalty + stale beliefs', () => {
  let mesh: any;

  before(async () => {
    mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
  });

  it('penalizes a memory only once its contradictor is validated', async () => {
    const oldBelief = await mesh.add('moon base alpha protocol requires oxygen recycling tanks', { type: 'decision', skipDedup: true });
    const newBelief = await mesh.add('moon base alpha protocol uses closed loop water reclamation instead', {
      type: 'decision',
      contradicts: oldBelief.id,
      skipDedup: true,
    });
    await waitFor(
      () => mesh.decisionLineage(newBelief.id, { direction: 'ancestors' }),
      (edges: any[]) => edges.some((e) => e.relation === 'contradicts'),
    );

    // Unvalidated contradiction: no penalty, no flag.
    const beforeRows = await mesh.search('moon base alpha protocol', { mode: 'vector', useCache: false });
    const beforeOld = beforeRows.find((r: any) => r.id === oldBelief.id);
    assert.ok(beforeOld, 'old belief still returned');
    assert.equal(beforeOld.contradicted_by, undefined, 'no flag before validation');

    await mesh.recordOutcome(newBelief.id, { status: 'validated' });
    const afterRows = await mesh.search('moon base alpha protocol', { mode: 'vector', useCache: false });
    const afterOld = afterRows.find((r: any) => r.id === oldBelief.id);
    const afterNew = afterRows.find((r: any) => r.id === newBelief.id);
    assert.ok(afterOld && afterNew, 'both beliefs returned');
    assert.deepEqual(afterOld.contradicted_by, [newBelief.id], 'flagged with its contradictor');
    assert.ok(afterOld.score < afterNew.score, 'contradicted belief ranks below its validated contradictor');
    assert.ok(afterRows.indexOf(afterNew) < afterRows.indexOf(afterOld), 'ordering follows the penalty');
  });

  it('staleBeliefs lists transitive dependents of a refuted decision with hop counts', async () => {
    const root = await mesh.add('decision: cache invalidation happens on write', { type: 'decision', skipDedup: true });
    const child = await mesh.add('decision: read path skips freshness checks', { type: 'decision', depends_on: root.id, skipDedup: true });
    const grandchild = await mesh.add('decision: replicas serve reads without version pins', { type: 'decision', depends_on: child.id, skipDedup: true });
    await waitFor(
      () => mesh.decisionLineage(root.id, { direction: 'dependents' }),
      (edges: any[]) => edges.length >= 2,
    );

    await mesh.recordOutcome(root.id, { status: 'refuted', note: 'writes can race' });
    const report = await mesh.staleBeliefs();
    const entry = report.find((r: any) => r.refuted.id === root.id);
    assert.ok(entry, 'refuted decision reported');
    assert.equal(entry.refuted.note, 'writes can race');
    const depIds = entry.dependents.map((d: any) => d.id);
    assert.ok(depIds.includes(child.id), 'direct dependent listed');
    assert.ok(depIds.includes(grandchild.id), 'transitive dependent listed');
    const hopOf = (id: string) => entry.dependents.find((d: any) => d.id === id).hop;
    assert.equal(hopOf(child.id), 1);
    assert.equal(hopOf(grandchild.id), 2);
  });

  it('is a no-op when the decision graph has nothing to say', async () => {
    const fresh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await fresh.init();
    const m = await fresh.add('a plain unconnected fact about granite counters', { type: 'note', skipDedup: true });
    const rows = await fresh.search('granite counters', { mode: 'vector', useCache: false });
    const hit = rows.find((r: any) => r.id === m.id);
    assert.ok(hit, 'result returned');
    assert.equal(hit.contradicted_by, undefined);
  });
});
