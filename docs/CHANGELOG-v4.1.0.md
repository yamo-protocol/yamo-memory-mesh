# @yamo/memory-mesh v4.1.0

**Date:** 2026-09-02

Minor release: additive, no breaking changes. Everything on `main` since
`v4.0.0` (`af25516`, `df1f62d`, `7b4c8cb`).

## Read-time grounding join (workspace-u2r)

Provenance-grounded refusal for derived memories, computed at query time —
no persisted truth-maintenance state (decision: workspace-d6n).

- `search()` now runs a **grounding join** on derived rows (`consolidation`,
  `reflection`, `summary_l*`, `lesson`) as the last ranking step, after the
  cross-encoder rerank, graph-RAG boost and contradiction penalty. Cited
  sources come from `depends-on` / `justified-by` decision edges first, else
  metadata `cited_ids` → `source_memory_ids` → `source_ids`. Each derived row
  gets `grounding_live` / `grounding_total`.
- A derived row that cites at least one source and has **zero live** sources
  (all superseded, archived, deferred or deleted under the query's own
  visibility) is marked `ungrounded`, its score is multiplied by
  **`UNGROUNDED_SCORE_FACTOR`** (default `0.25`, env-tunable, must be in
  `(0, 1]`), and the list is re-sorted. Rows with no recorded provenance are
  left alone — absence of evidence is not invalidation.
- `formatResults()` renders ungrounded rows inside an `[UNGROUNDED BEGIN]` /
  `[UNGROUNDED END]` fence, adds an `[UNGROUNDED]` marker and a
  `Grounding: live/total cited sources live` note, and appends a refusal line to
  the attention directive when any rendered row is ungrounded.
- If the join itself fails, derived rows come back marked `grounding_error`
  and render as `Grounding: UNCHECKED (join failed)` — a failed check is never
  indistinguishable from a passing one.
- **Keyword fallback gap closed:** the in-memory BM25 fallback re-checks its
  hits against the table's active-state clause, so a row superseded or archived
  by another process cannot re-enter recall through the keyword channel. Fails
  closed (returns nothing) if the check cannot run.
- **Cache fixes found along the way:** all search modes now store cache
  entries under the same key shape they look up with (the keyword/vector
  store paths previously dropped `includeArchived`, so an
  `includeArchived: true` result could be served to a default search); the
  cache key now includes `mode` (hybrid/vector/keyword previously shared one
  entry per query) and the grounding factor.
- Tests: `test/unit/grounding-join.test.ts` (10 tests, real temp LanceDB, no
  mocks) covering flag/down-rank, join arithmetic, premise-edge precedence,
  keyword-fallback fencing, cache invalidation on supersession, loud failure,
  and the tunable's bounds. Suite: 359/359.

**Consumer caveat (yamo-os):** the join is live and testable in the mesh, but
in yamo-os it is a no-op until a real supersession/deletion path exists there —
the runtime currently never supersedes or deletes, so grounding is always 100%.
Do not describe it as "working" in yamo-os before that path lands.

## Reflection provenance (workspace-5bo)

- `reflect()` records the ids of the memories it synthesized
  (`source_memory_ids`), not just a count (`af25516`). This is one of the
  metadata fallbacks the grounding join reads.

## Docs

- README: "Read-time grounding" section and `UNGROUNDED_SCORE_FACTOR` in the
  retrieval-tuning env block; `docs/USER_GUIDE.md` search-options subsection;
  `.env.example` updated.
