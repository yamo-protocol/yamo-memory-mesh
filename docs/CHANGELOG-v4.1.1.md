# @yamo/memory-mesh v4.1.1

**Date:** 2026-09-02

Patch release.

## Fixed

- **`setState(id, 'superseded')` now stamps `superseded_at`** (and
  `setState(id, 'active')` after a supersession clears it). Previously only the
  state word was written, while `_activeStateClause` and the 4.1.0 grounding
  join read the timestamp — so a state-only supersession stayed visible in
  default recall and counted as a *live* source. (workspace-3lq)
- `_activeStateClause` additionally excludes rows whose `state` is
  `'superseded'` regardless of the timestamp, so rows written by older builds
  are hidden too.
- Tests: three negative cases in `test/unit/lifecycle-prime.test.ts`
  (state-only supersession hides the row and grounds as dead; restore makes it
  visible again; a legacy state-only row is excluded). Suite: 362/362.

## Repository hygiene

- A `node_modules` symlink was committed by accident in `7b4c8cb` and is
  present in the `v4.1.0` git tag (the npm tarball was never affected —
  `npm pack` excludes it). Untracked on `main`; `.gitignore` now uses
  `node_modules` (no trailing slash) so a symlink of that name is ignored too.
