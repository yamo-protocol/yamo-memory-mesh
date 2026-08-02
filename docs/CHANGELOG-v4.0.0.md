# @yamo/memory-mesh v4.0.0

**Date:** 2026-08-02

## Breaking changes

- **`MemoryContextManager` removed** (with its `MemoryScorer` / `MemoryTranslator`
  chain). Deprecated in 3.2.6 (`b7be9c1`). It had no test coverage and no
  in-repo callers; consumers that need the high-level capture/recall layer
  should use `MemoryMesh` directly — `prime()` covers the curated-recall use
  case. (yamo-os carries its own independent implementation and is unaffected.)
- **Legacy `run()` JSON/stdin CLI handler removed** from the package entry and
  `memory-mesh.js` (self-invocation block included). The maintained CLI is the
  `memory-mesh` binary (`bin/memory_mesh.js`, 20 commands). Consumers that
  depend on the JSON action interface should own the dispatcher themselves,
  built on the public `MemoryMesh` API — see yamo-os `tools/memory_mesh.js`
  for the reference port (same output contract).

## Notable changes since 3.2.6 (unreleased on npm until now)

- **God-class split** (workspace-cg2): `memory-mesh.ts` 4,713 → ~1,100-line
  facade delegating to seam modules under `lib/memory/mesh/` (write, search,
  smora, skills, synthesis, lifecycle, maintenance, decision-graph, graph-rag,
  yamo-audit, lessons, rrf, shared). Public API unchanged.
- **RRF unified**: one weighted implementation (`mesh/rrf.ts`) behind
  search-hybrid, smora, and skill search.
- **Hybrid fusion weights** (workspace-2cx): keyword channel down-weighted to
  0.4 by paired-replicate eval (equal weights cost −0.155 MRR vs pure vector on
  paraphrase queries). Env-tunable: `HYBRID_VECTOR_WEIGHT` /
  `HYBRID_KEYWORD_WEIGHT`.
- **LanceDB 0.31** (workspace-axl): typed `orderBy` at the database, overscan
  fallbacks removed; LanceDB boundary typed (`LanceDBClient | null`,
  `lancedb.Table | null`).
- **zai LLM provider** (workspace-bmr): OpenAI-compatible dialect via
  api.z.ai (`glm-4.7` default, `ZAI_API_KEY` fallback).
- **Beads operational surface documented**: all 20 CLI commands in README /
  USER_GUIDE; CLI version reads from package.json.
- **Eval fixture grown** (workspace-i5r): 60 docs / 24 queries with confusable
  clusters — modes now differentiate (retrieval tuning must use paired
  replicates; single runs are noise-bound).
- **E2e coverage** (workspace-xdn): 13 e2e tests across every CLI command;
  fixed a `repeat(-n)` crash on long CLI headers.
- **CI**: `npm ci`, committed-JS staleness gate, e2e in CI, tests before
  publish.

## Migration

| If you used | Do this instead |
|---|---|
| `import { MemoryContextManager } from '@yamo/memory-mesh'` | Use `MemoryMesh` directly (`prime()` for curated recall), or vendor the 3.x class into your project |
| `import { run } from '@yamo/memory-mesh'` | Own the JSON dispatcher (reference: yamo-os `tools/memory_mesh.js`) or switch to the `memory-mesh` binary |
| `node lib/memory/memory-mesh.js <action> '<json>'` (self-invoke) | Same as above |
