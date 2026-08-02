import type { MemoryMesh } from "../memory-mesh.js";
/**
 * Validate and sanitize metadata to prevent prototype pollution
 * @private
 */
export declare function _validateMetadata(mesh: MemoryMesh, metadata: any): Record<string, any>;
/**
 * Sanitize and validate content before storage
 * @private
 */
export declare function _sanitizeContent(mesh: MemoryMesh, content: string): string;
/**
 * Add content to memory with auto-generated embedding and scrubbing.
 *
 * This is the primary method for storing information in the memory mesh.
 * The content goes through several processing steps:
 *
 * 1. **Scrubbing**: PII and sensitive data are sanitized (if enabled)
 * 2. **Validation**: Content length and metadata are validated
 * 3. **Embedding**: Content is converted to a vector representation
 * 4. **Storage**: Record is stored in LanceDB with metadata
 * 5. **Emission**: Optional YAMO block emitted for provenance tracking
 *
 * @param content - The text content to store in memory
 * @param metadata - Optional metadata (type, source, tags, etc.)
 * @returns Promise with memory record containing id, content, metadata, created_at
 *
 * @example
 * ```typescript
 * const memory = await mesh.add("User likes TypeScript", {
 *   type: "preference",
 *   source: "chat",
 *   tags: ["programming", "languages"]
 * });
 * ```
 *
 * @throws {Error} If content exceeds max length (100KB)
 * @throws {Error} If embedding generation fails
 * @throws {Error} If database client is not initialized
 */
export declare function add(mesh: MemoryMesh, content: string, metadata?: Record<string, any>): Promise<{
    id: any;
    content: string;
    metadata: Record<string, any>;
    created_at: string;
}>;
/**
 * Multi-chunk document ingest with Late Chunking (Jina, Sep 2024).
 *
 * Splits the document into chunks (paragraph-based for now — preserves
 * char offsets cleanly), embeds them with full-document context via
 * embedLateChunked() when the underlying model supports token-level
 * extraction, falls back to per-chunk embedding otherwise. Each chunk
 * lands as its own memory with provenance metadata linking back to the
 * parent document.
 *
 * Single-shot store path mesh.add() is unchanged — call addDocument()
 * explicitly when you want chunk-level retrieval granularity.
 *
 * Options:
 *   - minChunkChars / maxChunkChars: paragraph-merging bounds
 *     (defaults: 200 / 2000)
 *   - lateChunk: force on/off (default: auto — use Late Chunking if
 *     the embedder supports it and there's more than one chunk)
 */
export declare function addDocument(mesh: MemoryMesh, content: string, metadata?: Record<string, unknown>, options?: {
    minChunkChars?: number;
    maxChunkChars?: number;
    lateChunk?: boolean;
}): Promise<{
    documentId: string;
    chunks: number;
    ids: string[];
    lateChunked: boolean;
}>;
/**
 * Split a document into paragraph-based spans of (start, end) char
 * offsets, merging short paragraphs to honor minChars and forcing breaks
 * when exceeding maxChars. Spans are non-overlapping, ordered, and cover
 * the full content.
 * @private
 */
export declare function _splitParagraphSpans(mesh: MemoryMesh, content: string, minChars: number, maxChars: number): Array<{
    start: number;
    end: number;
}>;
/**
 * Update a memory entry's heritage_chain (RFC-0011 §8).
 */
export declare function insertHeritage(mesh: MemoryMesh, memoryId: string, heritage: {
    intentChain: string[];
    hypotheses: string[];
    rationales: string[];
}): Promise<void>;
/**
 * Agentic memory write judge (Mem0 / A-MEM / Letta pattern).
 *
 * Called from add() when a candidate memory falls in the gray zone of
 * similarity to an existing neighbor (similar but not a duplicate).
 * The LLM decides one of:
 *   - ADD:    new memory is genuinely new info → store alongside
 *   - UPDATE: new memory supersedes existing one → mark existing as
 *             superseded via metadata.replaces_memory_id
 *   - MERGE:  combine the two into a single richer memory → rewrite
 *             content and supersede the existing
 *   - NOOP:   new memory adds nothing the existing one doesn't cover
 *
 * Falls back to ADD on any failure (LLM disabled, throws, times out,
 * returns malformed JSON, returns an unknown decision). Latency bounded
 * by AGENTIC_OPS_TIMEOUT_MS (default 5000ms).
 */
export declare function _judgeMemoryWrite(mesh: MemoryMesh, newContent: string, neighbor: {
    id: string;
    content: string;
    score?: number;
}): Promise<{
    decision: 'ADD' | 'UPDATE' | 'MERGE' | 'NOOP';
    mergedContent?: string;
    rationale?: string;
}>;
/**
 * Emit a YAMO block recording an agentic ops decision for provenance.
 * Non-critical — failures are swallowed (caller wraps in .catch).
 */
export declare function _emitAgenticDecisionBlock(mesh: MemoryMesh, judgment: {
    decision: string;
    mergedContent?: string;
    rationale?: string;
}, neighborId: string, newContent: string): Promise<void>;
