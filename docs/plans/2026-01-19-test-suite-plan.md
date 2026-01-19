# Implementation Plan: MemoryMesh Test Suite

## Goal
Implement unit tests for `LanceDBClient` and `EmbeddingFactory` using `node:test`.

## Steps

### 1. Test Setup
- [ ] Create `yamo-memory-mesh/test/mocks/lancedb.js` to mock the LanceDB driver.
- [ ] Create `yamo-memory-mesh/test/mocks/embedding.js` to mock embedding generation.

### 2. LanceDBClient Tests (`test/lancedb.test.js`)
- [ ] Test `connect()` with successful mock.
- [ ] Test `connect()` with failures to verify retries.
- [ ] Test `add()` and `addBatch()`.
- [ ] Test `search()` with vector and filters.

### 3. EmbeddingFactory Tests (`test/embedding.test.js`)
- [ ] Test `configure()` sorting.
- [ ] Test `embed()` fallback logic.

### 4. Execution
- [ ] Run `node --test test/` to verify all pass.
