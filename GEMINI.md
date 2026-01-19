# MemoryMesh Project Context

## Project Overview
**MemoryMesh** is a portable, semantic memory system designed for AI agents. It features a sophisticated retrieval architecture (**S-MORA**) and a built-in privacy layer (**Layer 0 Scrubber**). It runs entirely locally using ONNX for embeddings and LanceDB for vector storage, requiring no external API keys for core functionality.

## Architecture: S-MORA
The core of the system is the **Semantic Memory Orchestrator & Retrieval Architecture (S-MORA)**, located in `lib/smora`. It implements a 4-stage pipeline:

1.  **Query Understanding (HyDE-Lite):**
    *   Generates "Hypothetical Document Embeddings" to align query semantics with potential answers.
    *   Located in `lib/smora/query-understanding`.
2.  **Hybrid Retrieval:**
    *   Combines vector similarity search (LanceDB) with keyword matching.
    *   Located in `lib/smora/retrieval`.
3.  **Context Compression:**
    *   Uses tree-based summarization to fit retrieved content into the context window.
    *   Located in `lib/smora/compression`.
4.  **Context Assembly:**
    *   Formats the final output for the LLM.
    *   Located in `lib/smora/assembly`.

**Layer 0 Scrubber:**
*   A privacy-first pre-processing stage that sanitizes, deduplicates, and cleans data *before* it enters the memory system.
*   Located in `lib/privacy` and `lib/smora/scrubber`.

## Key Components

### 1. CLI Tools (`bin/`)
*   **`memory-mesh`**: The primary interface for agents.
    *   `store <content> [metadata]`: Embeds and saves memory.
    *   `search <query> [limit]`: Retrieves relevant context.
    *   Outputs JSON for easy parsing by other tools/agents.
*   **`scrubber`**: Standalone tool for sanitizing text.

### 2. Core Library (`lib/`)
*   **`lib/memory/memory-mesh.js`**: High-level API wrapping the system.
*   **`lib/smora/orchestrator.js`**: The central coordinator for the retrieval pipeline.
*   **`lib/lancedb/`**: Database abstraction layer.
*   **`lib/embeddings/`**: ONNX-based local embedding generation.

## Development Context (Updated Jan 2026)

### TypeScript & Type Safety
The project has been migrated to a **Strict JSDoc Type-Checked** state. formal type checking is enforced via `npm run type-check`.
*   **Status:** ~90% type coverage across core modules.
*   **Core Mandate:** All new code must be type-safe. Use `error instanceof Error` narrowing in catch blocks.
*   **Patterns:** Private class fields use the `#` prefix. JSDoc should not include redundant `@private` tags for these members.

### Infrastructure Improvements
*   **Reliability:** Core data path (`MemoryMesh` -> `LanceDBClient`) is hardened with null safety and automatic retries.
*   **Privacy:** Built-in Layer 0 Scrubber now supports robust PII/Secret detection with template literal regex safety.
*   **Retrieval:** S-MORA pipeline supports batch operations and tree-based context compression.

