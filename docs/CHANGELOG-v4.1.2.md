# @yamo/memory-mesh v4.1.2

**Date:** 2026-09-30

Patch release.

## Fixed

- **`searchSkills` no longer crashes the process on a long query.** The
  database-side keyword hint built one `(name LIKE … OR intent LIKE … OR
  yamo_text LIKE …)` group per query token, with no bound and no
  deduplication. LanceDB refuses a filter of more than 500 conditions with an
  ordinary error, but a much larger one overflows its parser before that check
  runs and ends the process with SIGSEGV — which no `try/catch` can catch. A
  7,500-character prompt produced 1,379 tokens and 4,137 conditions; the yamo-os
  daemon died on every grounded prompt of that size that reached skill
  interception (workspace-8nj). Measured on the same store: 256 tokens worked,
  512 errored, 768 segfaulted.

  The filter now uses at most 32 distinct tokens, in order of appearance
  (`MAX_KEYWORD_FILTER_TOKENS`, 96 conditions). The vector search and the
  in-memory keyword scoring still see every token of the query, so a skill named
  in the first words of a long prompt is still found. Queries of up to 32
  distinct tokens are unaffected.

- Tests: `test/unit/skills-search-long-query.test.ts` runs a 60 KB query with
  thousands of distinct tokens against a real temporary LanceDB table — the
  crash was native, so a mock could not have caught it — and pins the token
  bound. Suite: 365/365.
