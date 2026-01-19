# MemoryMesh Test Plan

## Goal
Implement a comprehensive unit test suite for the `yamo-memory-mesh` package, focusing on the core data access layer (`LanceDBClient`) and embedding generation (`EmbeddingFactory`).

## Strategy
Since `lancedb` and `onnxruntime-node` are native modules that are hard to run in pure isolation or lightweight CI, we will use **Dependency Injection** and **Mocking**.

## Components to Test

### 1. LanceDBClient
- **Connection**: Verify retry logic on connection failure.
- **CRUD**: Verify `add`, `get`, `search`, `delete` delegate to the underlying driver correctly.
- **Error Handling**: Ensure `StorageError` and `QueryError` are thrown appropriately.

### 2. EmbeddingFactory
- **Configuration**: Verify primary/fallback priority.
- **Fallback**: Simulate primary failure and verify fallback service is called.
- **Batch**: Verify batch processing.

## Implementation Details
- Framework: `node:test` (native runner).
- Mocks: Custom mock implementations of `lancedb` connection and table objects.

## Success Criteria
- 80% coverage of `LanceDBClient` logic (excluding the actual native calls).
- Verification of retry mechanism.
- Verification of fallback mechanism.
