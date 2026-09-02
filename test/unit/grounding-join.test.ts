import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';
import {
  _parseGroundingFactor,
  _isDerivedType,
  DEFAULT_UNGROUNDED_SCORE_FACTOR,
  fenceUngrounded,
  UNGROUNDED_DIRECTIVE,
} from '../../lib/memory/mesh/search.js';

// Read-time grounding join (workspace-u2r). Real temp LanceDB (dbDir
// ':memory:' maps to an isolated tmp dir) — no mocks. Premise edges are
// written directly via _writeDecisionEdges: add() fires them without awaiting
// (see decision-edges.test.ts), so the join's inputs stay deterministic.

// Identical content for the rows under comparison so retrieval scores tie and
// only the grounding join can separate them (skipDedup keeps every copy).
const SHARED = 'the nightly ingest pipeline batches telemetry into parquet shards every six hours';

describe('read-time grounding join', () => {
  let mesh: any;

  before(async () => {
    mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, dbDir: ':memory:' });
    await mesh.init();
  });

  after(async () => {
    if (mesh.isInitialized) await mesh.close();
  });

  it('flags and down-ranks a derived row whose every cited source is gone; grounded and primary rows keep their place', async () => {
    const deadA = await mesh.add('telemetry shard cadence is six hours (old)', { type: 'event', skipDedup: true });
    const deadB = await mesh.add('telemetry shard cadence uses parquet (old)', { type: 'event', skipDedup: true });
    const liveC = await mesh.add('telemetry shards are compacted nightly', { type: 'event', skipDedup: true });

    const ungroundedRow = await mesh.add(SHARED, { type: 'reflection', skipDedup: true });
    const groundedRow = await mesh.add(SHARED, { type: 'reflection', skipDedup: true });
    const primaryRow = await mesh.add(SHARED, { type: 'event', skipDedup: true });
    await mesh._writeDecisionEdges(ungroundedRow.id, { depends_on: [deadA.id, deadB.id] }, []);
    await mesh._writeDecisionEdges(groundedRow.id, { depends_on: [liveC.id] }, []);
    // A primary row citing the same dead sources must never be touched.
    await mesh._writeDecisionEdges(primaryRow.id, { depends_on: [deadA.id, deadB.id] }, []);

    // Invalidate deadA by supersession and deadB by archival — both are
    // "not live" to _activeStateClause.
    await mesh.add('telemetry shard cadence is now three hours', { type: 'event', skipDedup: true, replaces_memory_id: deadA.id });
    await mesh.setState(deadB.id, 'archived');

    const rows = await mesh.search(SHARED, { limit: 10, useCache: false });
    const ug = rows.find((r: any) => r.id === ungroundedRow.id);
    const gr = rows.find((r: any) => r.id === groundedRow.id);
    const pr = rows.find((r: any) => r.id === primaryRow.id);
    assert.ok(ug && gr && pr, 'all three rows are returned');

    assert.equal(ug.grounding_total, 2);
    assert.equal(ug.grounding_live, 0);
    assert.equal(ug.ungrounded, true);

    assert.equal(gr.grounding_total, 1);
    assert.equal(gr.grounding_live, 1);
    assert.equal(gr.ungrounded, undefined, 'all-live derived row is not flagged');

    assert.equal(pr.grounding_total, undefined, 'non-derived row carries no grounding fields');
    assert.equal(pr.grounding_live, undefined);
    assert.equal(pr.ungrounded, undefined);

    // Ranking: the three copies tie before the join (normalized top scores
    // ~1.0 whether the cross-encoder or RRF produced them); the penalty is the
    // only thing that can separate them.
    assert.ok(gr.score > 0.9, `grounded derived row not penalized (score ${gr.score})`);
    assert.ok(pr.score > 0.9, `primary row not penalized (score ${pr.score})`);
    assert.ok(ug.score < 0.3, `ungrounded row down-ranked (score ${ug.score})`);
    assert.ok(rows.indexOf(gr) < rows.indexOf(ug), 'grounded derived row ranks above the ungrounded one');
    assert.ok(rows.indexOf(pr) < rows.indexOf(ug), 'primary row ranks above the ungrounded one');

    // Grounding follows the query's own visibility: opting archived rows back
    // in makes deadB a live source again, so the row is no longer ungrounded.
    const opted = await mesh.search(SHARED, { limit: 10, useCache: false, includeArchived: true });
    const ugOpted = opted.find((r: any) => r.id === ungroundedRow.id);
    assert.equal(ugOpted.grounding_live, 1);
    assert.equal(ugOpted.ungrounded, undefined);
  });

  it('join arithmetic is exact: factor × score for ungrounded, untouched otherwise, list re-sorted', async () => {
    const live = await mesh.add('isolated join live source row', { type: 'event', skipDedup: true });
    const dead = await mesh.add('isolated join dead source row', { type: 'event', skipDedup: true });
    await mesh.setState(dead.id, 'archived');
    const rows = [
      { id: 'u1', score: 1.0, content: 'x', metadata: { type: 'consolidation', cited_ids: [dead.id] } },
      { id: 'g1', score: 0.9, content: 'x', metadata: { type: 'summary_l2', source_memory_ids: [live.id, dead.id] } },
      { id: 'p1', score: 0.8, content: 'x', metadata: { type: 'event', source_ids: [dead.id] } },
      { id: 'n1', score: 0.7, content: 'x', metadata: { type: 'lesson' } },
    ];
    const out = await mesh._applyGroundingJoin(rows);
    const byId = Object.fromEntries(out.map((r: any) => [r.id, r]));

    assert.equal(byId.u1.ungrounded, true);
    assert.equal(byId.u1.grounding_live, 0);
    assert.equal(byId.u1.grounding_total, 1);
    assert.ok(Math.abs(byId.u1.score - 1.0 * DEFAULT_UNGROUNDED_SCORE_FACTOR) < 1e-12);

    assert.equal(byId.g1.ungrounded, undefined);
    assert.equal(byId.g1.grounding_live, 1);
    assert.equal(byId.g1.grounding_total, 2);
    assert.equal(byId.g1.score, 0.9, 'partially-grounded derived row keeps its score');

    assert.equal(byId.p1.grounding_total, undefined, 'non-derived row is never annotated');
    assert.equal(byId.p1.score, 0.8);

    // No recorded provenance is not "ungrounded": absence of evidence.
    assert.equal(byId.n1.grounding_total, 0);
    assert.equal(byId.n1.grounding_live, 0);
    assert.equal(byId.n1.ungrounded, undefined);
    assert.equal(byId.n1.score, 0.7);

    assert.deepEqual(out.map((r: any) => r.id), ['g1', 'p1', 'n1', 'u1'], 'ungrounded row sinks to the bottom');
  });

  it('prefers LLM-cited premise edges over batch-membership metadata', async () => {
    const live = await mesh.add('premise precedence live source', { type: 'event', skipDedup: true });
    const dead = await mesh.add('premise precedence dead source', { type: 'event', skipDedup: true });
    await mesh.setState(dead.id, 'archived');
    const row = await mesh.add('premise precedence derived row', {
      type: 'reflection',
      skipDedup: true,
      source_memory_ids: [dead.id], // batch membership says "all gone"
    });
    await mesh._writeDecisionEdges(row.id, { justified_by: [live.id] }, []); // the cited premise is alive
    const [out] = await mesh._applyGroundingJoin([{ id: row.id, score: 1, content: 'x', metadata: row.metadata }]);
    assert.equal(out.grounding_total, 1, 'edges replace, not merge with, the metadata list');
    assert.equal(out.grounding_live, 1);
    assert.equal(out.ungrounded, undefined);
    assert.equal(out.score, 1);
  });

  it('keyword fallback cannot resurface a row the table has superseded behind the index\'s back', async () => {
    const ghost = await mesh.add('quokka marsupial habitat rottnest island survey', { type: 'event', skipDedup: true });
    const alive = await mesh.add('quokka population survey on rottnest island continues', { type: 'event', skipDedup: true });
    // Supersede via the client directly — the in-memory keyword index is not
    // told, exactly as when another process performs the supersession.
    await mesh.client.update(ghost.id, { superseded_at: new Date(), state: 'superseded' });
    assert.ok(
      mesh.keywordSearch.search('quokka rottnest').some((h: any) => h.id === ghost.id),
      'precondition: the stale in-memory index still holds the ghost',
    );
    const originalFts = mesh.client.searchFts;
    mesh.client.searchFts = async () => { throw new Error('FTS unavailable'); };
    try {
      const keywordRows = await mesh.search('quokka rottnest', { mode: 'keyword', useCache: false });
      assert.ok(keywordRows.some((r: any) => r.id === alive.id), 'live row still returned through the fallback');
      assert.ok(!keywordRows.some((r: any) => r.id === ghost.id), 'superseded row fenced out of the keyword fallback');

      const hybridRows = await mesh.search('quokka rottnest', { mode: 'hybrid', useCache: false });
      assert.ok(!hybridRows.some((r: any) => r.id === ghost.id), 'superseded row fenced out of hybrid via the fallback channel');

      // An id the table has never seen passes through — the index is its only
      // witness (the native-fts.test.ts fallback contract is preserved).
      mesh.keywordSearch.add('index-only-id', 'quokka rottnest index only entry', {});
      try {
        const passthrough = await mesh.search('quokka rottnest', { mode: 'keyword', useCache: false });
        assert.ok(passthrough.some((r: any) => r.id === 'index-only-id'));
      } finally {
        mesh.keywordSearch.remove('index-only-id');
      }

      // Fail closed: if the visibility check itself cannot run, the keyword
      // channel returns nothing rather than leaking fenced rows.
      const savedTable = mesh.client.table;
      mesh.client.table = null;
      try {
        const closed = await mesh.search('quokka rottnest', { mode: 'keyword', useCache: false });
        assert.deepEqual(closed, []);
      } finally {
        mesh.client.table = savedTable;
      }
    } finally {
      mesh.client.searchFts = originalFts;
    }
  });

  it('cache: grounding state lives in the cached result and is invalidated by supersession; the factor is part of the key', async () => {
    const src = await mesh.add('basalt column source observation from the lava field', { type: 'event', skipDedup: true });
    const derived = await mesh.add('basalt columns form by cooling contraction of lava flows', {
      type: 'consolidation',
      skipDedup: true,
      cited_ids: [src.id],
    });
    const q = 'basalt columns cooling contraction';

    const first = await mesh.search(q, { limit: 5 });
    const d1 = first.find((r: any) => r.id === derived.id);
    assert.ok(d1, 'derived row retrieved');
    assert.equal(d1.grounding_live, 1);
    assert.equal(d1.ungrounded, undefined);

    // Supersede the source through the real belief-revision path (clears the cache).
    await mesh.add('basalt columns form by fracture propagation during cooling', {
      type: 'event',
      skipDedup: true,
      replaces_memory_id: src.id,
    });
    const second = await mesh.search(q, { limit: 5 });
    const d2 = second.find((r: any) => r.id === derived.id);
    assert.equal(d2.grounding_live, 0, 'cached grounding did not survive the supersession');
    assert.equal(d2.ungrounded, true);

    // Same query again: served from cache, annotations included.
    const third = await mesh.search(q, { limit: 5 });
    assert.strictEqual(third, second, 'cache hit returns the stored (annotated) result');

    // A different factor is a different key — not the cached array, and the
    // ungrounded row's score reflects the new factor.
    process.env.UNGROUNDED_SCORE_FACTOR = '1';
    try {
      const fourth = await mesh.search(q, { limit: 5 });
      assert.notStrictEqual(fourth, second, 'factor change misses the cache');
      const d4 = fourth.find((r: any) => r.id === derived.id);
      assert.equal(d4.ungrounded, true, 'still flagged at factor 1');
      assert.ok(d4.score > d2.score, 'factor 1 leaves the score un-penalized');
    } finally {
      delete process.env.UNGROUNDED_SCORE_FACTOR;
    }
  });

  it('a failed join is loud and representable: derived rows come back marked grounding_error, scores untouched, primary rows unmarked', async () => {
    const savedEdges = mesh.decisionEdgeTable;
    mesh.decisionEdgeTable = { query: () => ({ where: () => ({ toArray: async () => { throw new Error('edges down'); } }) }) };
    try {
      const out = await mesh._applyGroundingJoin([
        { id: 'd', score: 1.0, content: 'x', metadata: { type: 'consolidation', cited_ids: ['whatever'] } },
        { id: 'p', score: 0.5, content: 'y', metadata: { type: 'event' } },
      ]);
      const byId = Object.fromEntries(out.map((r: any) => [r.id, r]));
      assert.equal(byId.d.grounding_error, true, 'derived row is marked unchecked');
      assert.equal(byId.d.ungrounded, undefined, 'unchecked is not ungrounded');
      assert.equal(byId.d.grounding_total, undefined, 'no counts are invented');
      assert.equal(byId.d.score, 1.0, 'score untouched');
      assert.equal(byId.p.grounding_error, undefined, 'primary row never marked');
      const rendered = mesh.formatResults(out);
      assert.ok(rendered.includes('Grounding: UNCHECKED (join failed)'), 'unchecked state is rendered');
      assert.ok(!rendered.includes('[UNGROUNDED'), 'unchecked row is not fenced as ungrounded');
    } finally {
      mesh.decisionEdgeTable = savedEdges;
    }
  });

  it('search cache key distinguishes modes (pre-existing gap fixed alongside the grounding factor)', () => {
    const q = 'cache key mode probe';
    assert.notStrictEqual(mesh._generateCacheKey(q, { mode: 'vector' }), mesh._generateCacheKey(q, { mode: 'keyword' }));
    assert.notStrictEqual(mesh._generateCacheKey(q, { mode: 'hybrid' }), mesh._generateCacheKey(q, { mode: 'vector' }));
    assert.strictEqual(mesh._generateCacheKey(q, {}), mesh._generateCacheKey(q, { mode: 'hybrid' }), 'default mode is hybrid');
  });

  it('formatResults fences ungrounded rows and adds the refusal directive; grounded rows render plain', () => {
    const rows = [
      { id: 'g', score: 0.9, content: 'grounded belief', metadata: { type: 'reflection' }, grounding_live: 2, grounding_total: 2 },
      { id: 'u', score: 0.2, content: 'stale belief', metadata: { type: 'consolidation' }, grounding_live: 0, grounding_total: 3, ungrounded: true },
    ];
    const out = mesh.formatResults(rows);
    assert.ok(out.includes('[ATTENTION DIRECTIVE]') && out.includes('[MEMORY CONTEXT]'), 'existing structure intact');
    assert.ok(out.includes(UNGROUNDED_DIRECTIVE), 'directive present when an ungrounded row is rendered');
    assert.ok(out.includes('--- MEMORY 1: g [IMPORTANCE: 0.9] ---'));
    assert.ok(out.includes('Grounding: 2/2 cited sources live'));
    assert.ok(!out.includes(fenceUngrounded('grounded belief')), 'grounded row is not fenced');
    assert.ok(out.includes('--- MEMORY 2: u [IMPORTANCE: 0.2] [UNGROUNDED] ---'));
    assert.ok(out.includes('Grounding: 0/3 cited sources live'));
    assert.ok(out.includes(fenceUngrounded('stale belief')), 'ungrounded row is fenced');

    const clean = mesh.formatResults([rows[0]]);
    assert.ok(!clean.includes('[UNGROUNDED'), 'no marker or directive without an ungrounded row');
  });
});

describe('grounding tunable + derived-type gate', () => {
  it('_parseGroundingFactor accepts finite values in (0, 1] and falls back otherwise', () => {
    assert.strictEqual(_parseGroundingFactor('0.5', 0.25), 0.5);
    assert.strictEqual(_parseGroundingFactor('1', 0.25), 1);
    assert.strictEqual(_parseGroundingFactor('0.01', 0.25), 0.01);
    assert.strictEqual(_parseGroundingFactor(undefined, 0.25), 0.25);
    assert.strictEqual(_parseGroundingFactor('', 0.25), 0.25);
    assert.strictEqual(_parseGroundingFactor('abc', 0.25), 0.25);
    assert.strictEqual(_parseGroundingFactor('0', 0.25), 0.25);
    assert.strictEqual(_parseGroundingFactor('-0.5', 0.25), 0.25);
    assert.strictEqual(_parseGroundingFactor('1.5', 0.25), 0.25, 'a factor above 1 would boost ungrounded rows');
    assert.strictEqual(_parseGroundingFactor('Infinity', 0.25), 0.25);
    assert.strictEqual(DEFAULT_UNGROUNDED_SCORE_FACTOR, 0.25);
  });

  it('_isDerivedType matches the derived vocabulary only', () => {
    for (const t of ['consolidation', 'reflection', 'lesson', 'summary_l1', 'summary_l2', 'summary_l10']) {
      assert.strictEqual(_isDerivedType(t), true, t);
    }
    for (const t of ['event', 'decision', 'insight', 'pattern', 'note', 'summary', 'preference', undefined, null, 42]) {
      assert.strictEqual(_isDerivedType(t), false, String(t));
    }
  });
});
