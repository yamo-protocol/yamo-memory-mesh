/**
 * YAMO Brain Module
 * Semantic memory mesh with vector search capabilities
 */
export { MemoryMesh, run, } from "./memory-mesh.js";
// NOTE: MemoryContextManager and run are @deprecated (removal planned for v4)
// — see their declarations. New code should use MemoryMesh + bin/memory_mesh.js.
export { MemoryContextManager } from "./context-manager.js";
export { LanceDBClient } from "./adapters/client.js";
export * from "./embeddings/index.js";
export * from "./search/index.js";
