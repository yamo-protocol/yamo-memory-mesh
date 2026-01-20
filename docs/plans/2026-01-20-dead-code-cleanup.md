# Implementation Plan: Dead Code Cleanup

## Goal
Remove ~1,600 lines of dead code from yamo-memory-mesh v2.2.0 to reduce maintenance burden and improve code clarity.

## Architecture
- **Approach**: Incremental deletion with running tests after each batch
- **Tech Stack**: Node.js native test runner, git worktree for isolated changes
- **Test Strategy**: Run `npm test` after each batch to ensure no regressions

## Past Patterns
No similar cleanup workflows found in memory. This is a first-time operation.

---

## Tasks

### Batch 1: Empty Directories (Safe - No Tests Needed)
**Estimated time**: 2 minutes

1. **Delete empty `lib/adapters/` directory**
   - Command: `rm -rf lib/adapters/`
   - Rationale: Directory is empty, never used

2. **Delete empty `lib/reporting/` directory**
   - Command: `rm -rf lib/reporting/`
   - Rationale: Directory is empty, never used

3. **Commit Batch 1**
   - Command: `git add -A && git commit -m "refactor: remove empty directories lib/adapters and lib/reporting"`

---

### Batch 2: Unused Search Utilities (~570 lines)
**Estimated time**: 5 minutes

4. **Delete unused search utilities**
   - Files to delete:
     - `lib/search/filter.js` (276 lines - FilterBuilder never imported)
     - `lib/search/pattern-miner.js` (160 lines - PatternMiner never imported)
     - `lib/search/hybrid.js` (137 lines - HybridSearch never imported)
   - Command: `rm lib/search/filter.js lib/search/pattern-miner.js lib/search/hybrid.js`

5. **Update `lib/search/index.js`**
   - Remove exports for deleted modules
   - Add export for `KeywordSearch` (currently used but not exported)
   - New content:
   ```js
   export { KeywordSearch } from './keyword-search.js';
   ```

6. **Run tests**
   - Command: `npm test`
   - Expected: All tests pass (these were never used)

7. **Commit Batch 2**
   - Command: `git add -A && git commit -m "refactor: remove unused search utilities (FilterBuilder, PatternMiner, HybridSearch)"`

---

### Batch 3: Unused Memory Manager Chain (~700 lines)
**Estimated time**: 5 minutes

8. **Delete unused memory manager files**
   - Files to delete:
     - `lib/memory/memory-context-manager.js` (389 lines - never imported)
     - `lib/memory/scorer.js` (86 lines - only used by MemoryContextManager)
     - `lib/memory/memory-translator.js` (130 lines - only used by MemoryContextManager)
   - Command: `rm lib/memory/memory-context-manager.js lib/memory/scorer.js lib/memory/memory-translator.js`

9. **Run tests**
   - Command: `npm test`
   - Expected: All tests pass (these were never used)

10. **Commit Batch 3**
    - Command: `git add -A && git commit -m "refactor: remove unused memory manager chain (MemoryContextManager, MemoryScorer, MemoryTranslator)"`

---

### Batch 4: Unused Utils (~150 lines)
**Estimated time**: 5 minutes

11. **Delete unused utility files**
    - Files to delete:
      - `lib/utils/handoff-validator.js` (86 lines - never imported)
      - `lib/utils/spinner.js` (never imported)
      - `lib/utils/streaming-client.js` (never imported)
      - `lib/utils/error-sanitizer.js` (never imported)
    - Command: `rm lib/utils/handoff-validator.js lib/utils/spinner.js lib/utils/streaming-client.js lib/utils/error-sanitizer.js`

12. **Update `lib/utils/index.js`**
    - File should become empty or export nothing
    - New content:
    ```js
    // No exports - all utilities removed
    ```

13. **Update `lib/index.js`**
    - Remove utils imports and exports (lines 8-16)
    - Remove the entire export block for utils

14. **Run tests**
    - Command: `npm test`
    - Expected: All tests pass

15. **Commit Batch 4**
    - Command: `git add -A && git commit -m "refactor: remove unused utils (HandoffValidator, Spinner, StreamingClient, error sanitizer)"`

---

### Batch 5: Privacy Module Cleanup (~250 lines)
**Estimated time**: 5 minutes

16. **Delete unused privacy module**
    - Files to delete:
      - `lib/privacy/dlp-redactor.js` (72 lines - stub + never imported)
      - `lib/privacy/audit-logger.js` (176 lines - never imported)
      - `lib/privacy/index.js` (re-exports only)
    - Command: `rm -rf lib/privacy/`

17. **Update `lib/index.js`**
    - Remove line 5: `export * from './privacy/index.js';`

18. **Run tests**
    - Command: `npm test`
    - Expected: All tests pass

19. **Commit Batch 5**
    - Command: `git add -A && git commit -m "refactor: remove unused privacy module (DLPRedactor, AuditLogger)"`

---

### Batch 6: Final Verification
**Estimated time**: 3 minutes

20. **Run full test suite**
    - Command: `npm test`
    - Verify all tests pass

21. **Type checking**
    - Command: `npm run type-check`
    - Verify no TypeScript errors

22. **Update documentation**
    - Review CLAUDE.md for references to deleted code
    - Update if necessary

23. **Final commit if any doc changes**
    - Command: `git add docs/ && git commit -m "docs: update documentation after dead code cleanup"`

---

## Summary

| Batch | Files Deleted | Lines Removed | Risk |
|-------|---------------|---------------|------|
| 1 | 2 dirs | 0 | None |
| 2 | 3 files | ~570 | Low |
| 3 | 3 files | ~700 | Low |
| 4 | 4 files | ~150 | Low |
| 5 | 3 files | ~250 | Low |
| **Total** | **15 files, 2 dirs** | **~1,670** | **Low** |

## Success Criteria
- All npm tests pass
- No TypeScript errors
- lib/index.js exports only active, used modules
- Package still functions correctly for external consumers

## Rollback Plan
If any batch fails: `git reset --hard HEAD~1` and investigate the failing test.
