import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// Passive JSONL export/import (workspace-g9p.2): deterministic bytes, no
// vectors, lossless round-trip into a fresh store with local re-embedding.
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

describe('MemoryMesh export/import', () => {
  let source: any;
  let ids: Record<string, string> = {};

  before(async () => {
    source = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await source.init();
    const a = await source.add('the primary export fixture references borosilicate glassware', { type: 'note', skipDedup: true });
    const b = await source.add('decision: export fixtures are seeded once per suite', { type: 'decision', depends_on: a.id, skipDedup: true });
    await source.pin(a.id);
    await source.deferMemory(b.id, new Date(Date.now() - 1000));
    await waitFor(
      () => source.decisionLineage(b.id, { direction: 'ancestors' }),
      (edges: any[]) => edges.length >= 1,
    );
    ids = { a: a.id, b: b.id };
  });

  it('consecutive exports of an unchanged store are byte-identical and vector-free', async () => {
    const one = await source.exportJsonl();
    const two = await source.exportJsonl();
    assert.equal(one.text, two.text, 'deterministic bytes');
    assert.ok(!one.text!.includes('"vector"'), 'vectors excluded');
    assert.match(one.text!, /"_export":\{"format":1\}/);
    assert.match(one.text!, /"table":"memory_entries"/);
    assert.match(one.text!, /"table":"decision_edges"/);
  });

  it('round-trips into a fresh store with re-embedded vectors and preserved fields', async () => {
    const dump = await source.exportJsonl();
    const target = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await target.init();
    const counts = await target.importJsonl({ text: dump.text! });
    assert.ok(counts.memory_entries.imported >= 2, 'memories imported');
    assert.ok((counts.decision_edges?.imported ?? 0) >= 1, 'edges imported');

    const a = await target.client.getById(ids.a);
    assert.ok(a, 'row exists under original id');
    assert.match(a.content, /borosilicate glassware/);
    assert.equal(a.pinned, true, 'pinned survived');
    // LanceDB returns vectors as Arrow FixedSizeList, not a JS Array — check length only.
    assert.ok(a.vector && a.vector.length > 0, 're-embedded');

    const found = await target.search('borosilicate glassware fixture', { mode: 'vector', useCache: false });
    assert.ok(found.some((r: any) => r.id === ids.a), 'semantic search works on re-embedded row');

    const lineage = await target.decisionLineage(ids.b, { direction: 'ancestors' });
    assert.ok(lineage.some((e: any) => e.to === ids.a), 'decision edge round-tripped');

    const again = await target.importJsonl({ text: dump.text! });
    assert.equal(again.memory_entries.imported, 0, 'second import skips everything');
    assert.ok(again.memory_entries.skipped >= 2, 'skips reported');
  });

  it('rejects input without the format header', async () => {
    const target = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await target.init();
    await assert.rejects(() => target.importJsonl({ text: '{"table":"memory_entries","id":"x"}\n' }), /format-1 header/);
  });
});
