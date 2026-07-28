import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// Append-only revision history (workspace-g9p.3). Revision writes are
// fire-and-forget, so assertions poll history() until rows land.
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

describe('MemoryMesh revisions', () => {
  let mesh: any;

  before(async () => {
    mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
  });

  it('recordOutcome appends old/new importance and outcome revisions', async () => {
    const m = await mesh.add('decision: use the object update overload everywhere', { type: 'decision', skipDedup: true });
    await mesh.recordOutcome(m.id, { status: 'refuted', note: 'caused drift' });
    const history = await waitFor(
      () => mesh.history(m.id),
      (h: any[]) => h.some((r) => r.field === 'importance_score'),
    );
    const imp = history.find((r: any) => r.field === 'importance_score');
    assert.ok(imp, 'importance revision recorded');
    assert.equal(imp.new_value, 0.2);
    const out = history.find((r: any) => r.field === 'metadata.outcome');
    assert.ok(out, 'outcome revision recorded');
    assert.equal(out.new_value.status, 'refuted');
    assert.equal(out.old_value, null);
  });

  it('setState and pin changes are captured with old and new values', async () => {
    const m = await mesh.add('lifecycle revision capture row', { type: 'note', skipDedup: true });
    await mesh.setState(m.id, 'deprecated');
    await mesh.pin(m.id);
    const history = await waitFor(
      () => mesh.history(m.id),
      (h: any[]) => h.some((r) => r.field === 'state') && h.some((r) => r.field === 'pinned'),
    );
    const state = history.find((r: any) => r.field === 'state');
    assert.equal(state.old_value, 'active');
    assert.equal(state.new_value, 'deprecated');
    const pinned = history.find((r: any) => r.field === 'pinned');
    assert.equal(pinned.old_value, false);
    assert.equal(pinned.new_value, true);
  });

  it('belief revision leaves a superseded_by revision on the old row', async () => {
    const first = await mesh.add('the retry limit is three attempts', { type: 'decision', key: 'rev-retry-limit', skipDedup: true });
    const second = await mesh.add('the retry limit is five attempts', { type: 'decision', key: 'rev-retry-limit', skipDedup: true });
    const history = await waitFor(
      () => mesh.history(first.id),
      (h: any[]) => h.some((r) => r.field === 'superseded_by'),
    );
    const sup = history.find((r: any) => r.field === 'superseded_by');
    assert.equal(sup.new_value, second.id);
  });

  it('delete snapshots the row and restoreDeleted resurrects it', async () => {
    const m = await mesh.add('ephemeral fact scheduled for deletion and restore', { type: 'note', tagged: 'restore-me', skipDedup: true });
    await mesh.delete(m.id);
    assert.equal(await mesh.get(m.id), null, 'row deleted');
    await waitFor(
      () => mesh.history(m.id),
      (h: any[]) => h.some((r) => r.field === 'deleted'),
    );
    const restored = await mesh.restoreDeleted(m.id);
    assert.ok(restored, 'restore returns the row');
    assert.match(restored.content, /deletion and restore/);
    const back = await mesh.get(m.id);
    assert.ok(back, 'row exists again under its original id');
    assert.equal(back.metadata.tagged, 'restore-me');
  });

  it('history is ordered oldest-first', async () => {
    const m = await mesh.add('ordering probe row', { type: 'note', skipDedup: true });
    await mesh.setState(m.id, 'deprecated');
    await mesh.setState(m.id, 'active');
    const history = await waitFor(
      () => mesh.history(m.id),
      (h: any[]) => h.filter((r) => r.field === 'state').length >= 2,
    );
    const states = history.filter((r: any) => r.field === 'state');
    assert.equal(states[0].new_value, 'deprecated');
    assert.equal(states[1].new_value, 'active');
  });
});
