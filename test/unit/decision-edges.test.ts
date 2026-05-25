import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// Exercises the Decision Context Graph edge layer (workspace-d80) and the
// intra-call dedup added in workspace-vc1. _writeDecisionEdges is invoked
// directly with synthetic ids: add() writes edges fire-and-forget (racy to
// observe) and the edge store keys on string ids, not memory rows — so we get
// deterministic coverage without the ONNX model.
describe('MemoryMesh decision edges', () => {
  let mesh: any;

  before(async () => {
    mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
  });

  it('collapses duplicate (target, relation) pairs within a write', async () => {
    await mesh._writeDecisionEdges('src_dup', { depends_on: ['t1', 't1', 't1'], reasoning: 'r' }, []);
    const anc = await mesh.decisionLineage('src_dup', { direction: 'ancestors' });
    const dependsEdges = anc.filter((e: any) => e.relation === 'depends-on' && e.to === 't1');
    assert.equal(dependsEdges.length, 1);
    assert.equal(dependsEdges[0].rationale, 'r');
  });

  it('keeps distinct relations to the same target', async () => {
    await mesh._writeDecisionEdges('src_multi', { depends_on: ['t2'], justified_by: ['t2'] }, []);
    const anc = await mesh.decisionLineage('src_multi', { direction: 'ancestors' });
    const toT2 = anc.filter((e: any) => e.to === 't2');
    assert.equal(toT2.length, 2);
    assert.deepEqual(toT2.map((e: any) => e.relation).sort(), ['depends-on', 'justified-by']);
  });

  it('dedups supersededIds and skips self-edges', async () => {
    await mesh._writeDecisionEdges('src_self', { contradicts: ['src_self', 't3'] }, ['s_old', 's_old']);
    const anc = await mesh.decisionLineage('src_self', { direction: 'ancestors' });
    const sup = anc.filter((e: any) => e.relation === 'supersedes');
    assert.equal(sup.length, 1, 'duplicate supersededIds collapse to one edge');
    assert.equal(sup[0].to, 's_old');
    assert.ok(!anc.some((e: any) => e.to === 'src_self'), 'self-edge (target == source) is skipped');
    assert.ok(anc.some((e: any) => e.relation === 'contradicts' && e.to === 't3'));
  });

  it('carries hypothesis_confidence into edge weight, defaults to 1.0', async () => {
    await mesh._writeDecisionEdges('src_w', { depends_on: ['tw'], hypothesis_confidence: 0.42 }, []);
    await mesh._writeDecisionEdges('src_nw', { depends_on: ['tnw'] }, []);
    const w = (await mesh.decisionLineage('src_w', { direction: 'ancestors' }))[0];
    const nw = (await mesh.decisionLineage('src_nw', { direction: 'ancestors' }))[0];
    assert.ok(Math.abs(w.weight - 0.42) < 1e-6);
    assert.equal(nw.weight, 1.0);
  });

  it('traverses dependents direction and filters by relation', async () => {
    await mesh._writeDecisionEdges('dep_a', { depends_on: ['hub'] }, []);   // dep_a -depends-on-> hub
    await mesh._writeDecisionEdges('dep_b', {}, ['hub']);                    // dep_b -supersedes-> hub
    const dependents = await mesh.decisionLineage('hub', { direction: 'dependents' });
    assert.equal(dependents.length, 2);
    const filtered = await mesh.decisionLineage('hub', { direction: 'dependents', relations: ['supersedes'] });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].from, 'dep_b');
  });

  it('recordOutcome stores outcome metadata on the decision', async () => {
    const d = await mesh.add('Adopt feature flags for safer rollouts', { type: 'decision' });
    await mesh.recordOutcome(d.id, { status: 'refuted', note: 'caused config drift' });
    const got = await mesh.get(d.id);
    assert.equal(got.metadata.outcome.status, 'refuted');
    assert.equal(got.metadata.outcome.note, 'caused config drift');
    assert.ok(got.metadata.outcome.observed_at);
  });
});
