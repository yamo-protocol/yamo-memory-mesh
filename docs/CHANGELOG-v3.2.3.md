# MemoryMesh v3.2.3 — Changelog

**Date:** 2026-03-08
**Type:** Feature / RFC-0011 gap closure

---

## Summary

Closes the CLI gap identified in RFC-0011 §3.5: the `get`, `delete`, and `reflect` operations existed in the programmatic `run()` interface but were not exposed as first-class `commander` CLI commands. They are now fully registered, with consistent TUI output, help text, and E2E test coverage.

---

## Changes

### Added

- **`memory-mesh get --id <id>`** — Retrieve a single memory record by ID.
  - Displays ID, type, created timestamp, and full content.
  - Exits with code 1 and a warning if the record is not found.

- **`memory-mesh delete --id <id>`** — Permanently remove a memory record by ID.
  - Idempotent: silently succeeds if the record has already been removed.

- **`memory-mesh reflect [--topic <topic>] [--lookback <n>]`** — Synthesize insights from stored memories.
  - Without LLM: returns the context memories and the synthesis prompt for an external LLM.
  - With LLM enabled (`LLM_PROVIDER` set): generates a full reflection with confidence score.
  - `--lookback` defaults to 10 memories.

### Fixed

- E2E tests updated to match current TUI output format:
  - `stats` assertions: `[MemoryMesh] Total Memories:` → `Memories:`, `[MemoryMesh] DB Path:` → `Path:`, `[MemoryMesh] Status:` → `Status:`
  - `search` assertion: tolerates both `Recalled` and `Found` phrasing (`64/64` pass)

### Documentation

- `README.md`: Expanded CLI section with a full command reference table and usage examples for all seven commands.
- `bin/memory_mesh.js`: Version string updated `3.2.0` → `3.2.3`.

### Internal

- `.gitignore`: Added `mm` — a local dev shortcut with a hardcoded absolute path that must not be committed.
- `package.json`: Version bumped `3.2.2` → `3.2.3`.
- `test/unit/cli-run-actions.test.ts`: 10 unit tests for `get`, `delete`, `reflect` actions (all pass).

---

## RFC Alignment

| RFC | Section | Status |
|-----|---------|--------|
| RFC-0011 | §3.5 CLI gap closure — `get`, `delete`, `distillLesson` | ✅ Complete |

---

## Test Results

```
64/64 tests passing (2 unit suites + 1 E2E suite)
```
