/**
 * Tests for type-aware recency decay in smora() (workspace-pu2).
 *
 * Validates that lessons/decisions decay slower than events for the same
 * age — so a 30-day-old lesson stays competitive while a 30-day-old
 * episodic event sinks. Unknown types fall back to the default decay
 * (0.05, ~14d half-life) preserving previous behavior.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

const DAY_MS = 86400000;

/** Helper: stub a mesh with a controlled corpus of varied types/ages. */
async function meshWith(records: Array<{ id: string; content: string; type: string; ageDays: number }>) {
  const mesh: any = new MemoryMesh({
    dbDir: ':memory:',
    enableYamo: false,
    enableLLM: false,
    enableReranker: false,
  });
  await mesh.init();
  // Back-date docs against the moment smora() will compute "now"; capture
  // the doc list lazily so age stays accurate even after init() warmup.
  const buildDocs = () => {
    const now = Date.now();
    return records.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: JSON.stringify({ type: r.type }),
      score: 0.5, // _distance — neutral
      created_at: new Date(now - r.ageDays * DAY_MS).toISOString(),
    }));
  };
  // Patch in place so client.disconnect/etc. stay available for close().
  mesh.client.search = async () => buildDocs();
  mesh.client.searchFts = async () => [];
  mesh.keywordSearch.search = () => [];
  return mesh;
}

describe('smora — type-aware recency decay', () => {
  let mesh: any;
  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('lesson at 30d retains higher recencyDecay than event at 30d', async () => {
    mesh = await meshWith([
      { id: 'old-lesson', content: 'avoid double-charge on payment retry', type: 'lesson', ageDays: 30 },
      { id: 'old-event',  content: 'user clicked button on dashboard',     type: 'event',  ageDays: 30 },
    ]);
    const r = await mesh.smora('payment retry handling', { limit: 5, enableHyDE: false });
    const lesson = r.results.find((x: any) => x.id === 'old-lesson')!;
    const event = r.results.find((x: any) => x.id === 'old-event')!;
    assert.ok(lesson && event);
    // lesson λ=0.005, event λ=0.05 → at 30d: e^-0.15 ≈ 0.861 vs e^-1.5 ≈ 0.223
    assert.ok(lesson.recencyDecay > event.recencyDecay,
      `lesson(${lesson.recencyDecay}) should outlast event(${event.recencyDecay}) at 30d`);
    // Calibration check: lesson at 30d should still be > 0.8
    assert.ok(lesson.recencyDecay > 0.8, `lesson(30d) recencyDecay=${lesson.recencyDecay} should still be >0.8`);
    // Event at 30d should be < 0.3
    assert.ok(event.recencyDecay < 0.3, `event(30d) recencyDecay=${event.recencyDecay} should be <0.3`);
  });

  it('decision and consolidation decay at the same rate as each other (λ=0.01)', async () => {
    mesh = await meshWith([
      { id: 'd-30',   content: 'use Redis for session store', type: 'decision',      ageDays: 30 },
      { id: 'c-30',   content: 'sessions belong in Redis',    type: 'consolidation', ageDays: 30 },
    ]);
    const r = await mesh.smora('session storage', { limit: 5, enableHyDE: false });
    const d = r.results.find((x: any) => x.id === 'd-30')!;
    const c = r.results.find((x: any) => x.id === 'c-30')!;
    // Both should have ~equal recencyDecay (same λ + same age)
    assert.ok(Math.abs(d.recencyDecay - c.recencyDecay) < 1e-6,
      `decision(${d.recencyDecay}) and consolidation(${c.recencyDecay}) should match`);
  });

  it('unknown type falls back to default λ=0.05 (preserves prior behavior)', async () => {
    mesh = await meshWith([
      { id: 'unknown-30', content: 'some content', type: 'totally-made-up-type', ageDays: 30 },
      { id: 'event-30',   content: 'some content', type: 'event',                ageDays: 30 },
    ]);
    const r = await mesh.smora('content', { limit: 5, enableHyDE: false });
    const unk = r.results.find((x: any) => x.id === 'unknown-30')!;
    const evt = r.results.find((x: any) => x.id === 'event-30')!;
    // Both use λ=0.05 at 30d → same recencyDecay
    assert.ok(Math.abs(unk.recencyDecay - evt.recencyDecay) < 1e-6,
      `unknown type should match event decay, got ${unk.recencyDecay} vs ${evt.recencyDecay}`);
  });

  it('fresh memory (age 0) gets recencyDecay near 1 regardless of type', async () => {
    mesh = await meshWith([
      { id: 'fresh-lesson', content: 'X', type: 'lesson', ageDays: 0 },
      { id: 'fresh-event',  content: 'X', type: 'event',  ageDays: 0 },
    ]);
    const r = await mesh.smora('X', { limit: 5, enableHyDE: false });
    // "age 0" docs are stamped just before smora() reads now, so there's a
    // few-ms gap. Tolerance of 0.001 is way more than enough headroom.
    for (const row of r.results) {
      assert.ok(row.recencyDecay > 0.999, `${row.id} should be near 1.0 at age 0, got ${row.recencyDecay}`);
    }
  });

  it('lesson half-life is ~140 days (λ=0.005)', async () => {
    mesh = await meshWith([
      { id: 'lesson-140', content: 'X', type: 'lesson', ageDays: 140 },
    ]);
    const r = await mesh.smora('X', { limit: 5, enableHyDE: false });
    const row = r.results[0];
    // e^(-0.005*140) = e^-0.7 ≈ 0.4966 — half-life is at ln(2)/0.005 ≈ 138.6d
    assert.ok(Math.abs(row.recencyDecay - 0.5) < 0.05,
      `lesson@140d should be near 0.5 (half-life), got ${row.recencyDecay}`);
  });
});
