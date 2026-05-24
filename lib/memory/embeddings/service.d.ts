/**
 * Return per-task instruction prefixes for embedding models that were
 * trained with them. Asymmetric retrieval performance regresses badly
 * if these are omitted (BGE-base: ~10pt MRR loss without query prefix).
 *
 * Returns null for models that don't use prefixes (BGE-M3, MiniLM, mpnet,
 * etc.) — in that case caller passes raw text both ways.
 *
 * EMBEDDING_INSTRUCTION_PREFIXES=off disables prefixing even for matched
 * models (useful for backward compat or experiments).
 */
export declare function getInstructionPrefix(modelName: string): {
    query: string;
    passage: string;
} | null;
/**
 * EmbeddingService provides a unified interface for generating text embeddings
 * using multiple backend providers (local ONNX models or cloud APIs).
 */
export declare class EmbeddingService {
    modelType: any;
    modelName: any;
    baseUrl: any;
    dimension: any;
    batchSize: any;
    normalize: any;
    apiKey: any;
    model: any;
    cache: any;
    cacheMaxSize: any;
    initialized: any;
    stats: any;
    /**
     * Create a new EmbeddingService instance
     * @param {Object} [config={}] - Configuration options
     */
    constructor(config?: {});
    /**
     * Initialize the embedding model
     * Loads the model based on modelType (local, ollama, openai, cohere)
     */
    init(): Promise<void>;
    /**
     * Generate embedding for a single text
     * @param {string} text - Text to embed
     * @param {Object} options - Options for embedding generation
     * @returns {Promise<number[]>} Embedding vector
     */
    embed(text: any, options?: {}): Promise<any>;
    /**
     * Matryoshka-style truncation: slice the vector to targetDimension and
     * re-normalize. Matryoshka-trained models (nomic-embed-text-v1.5, Jina-v3,
     * Arctic-embed-l-v2) explicitly support this for storage/latency
     * trade-offs. Non-Matryoshka models tolerate it with some quality loss.
     * @private
     */
    _maybeTruncate(embedding: any, targetDimension: any): any;
    /**
     * Generate embeddings for a batch of texts
     * @param {string[]} texts - Array of texts to embed
     * @param {Object} options - Options for embedding generation
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    embedBatch(texts: any, options?: {}): Promise<any[]>;
    /**
     * Late Chunking (Jina, Sep 2024): embed the full document through the
     * encoder once with pooling disabled, then mean-pool the token-level
     * embeddings per chunk span. Each chunk vector then encodes the
     * preceding/following context picked up by transformer attention,
     * not just its own tokens. Significant quality wins on multi-paragraph
     * reasoning at zero retrieval-time cost.
     *
     * Returns null when:
     *   - the backend isn't 'local' (token-level access is HF/ONNX-specific)
     *   - the model returns pooled output only (no offset mapping or 3D tensor)
     *   - any error in the inference path
     * The caller should fall back to per-chunk embed() in that case.
     *
     * Spans are character ranges in `fullText`. Empty array → empty array.
     * @param fullText The complete document.
     * @param spans    Array of { start, end } char ranges (non-overlapping, in order).
     * @returns Array of L2-normalized vectors aligned to spans, or null.
     */
    embedLateChunked(fullText: any, spans: any, options?: {}): Promise<any[]>;
    /**
     * Token-level embedding for ColBERT-style late-interaction scoring.
     * Returns the per-token vectors as a flat Float32Array (length =
     * numTokens × dim) plus shape metadata, or null if the backend can't
     * produce token-level output. Caller pairs this with maxSim() from
     * ./colbert.js to score query/doc token alignment.
     *
     * Applies the configured instruction prefix (for query/passage
     * asymmetry) and L2-normalizes each token vector individually so
     * MaxSim's cosine assumption holds. Skips [CLS]/[SEP]/[PAD] tokens
     * via their [0,0] offset markers.
     */
    embedTokens(text: any, options?: {}): Promise<{
        data: Float32Array<ArrayBuffer>;
        numTokens: number;
        dim: any;
    }>;
    /**
     * Initialize local ONNX model using Xenova/Transformers.js
     * @private
     */
    _initLocalModel(): Promise<void>;
    /**
     * Initialize Ollama client
     * Ollama runs locally and doesn't require authentication
     * @private
     */
    _initOllama(): void;
    /**
     * Initialize OpenAI client
     * @private
     */
    _initOpenAI(): Promise<void>;
    /**
     * Initialize Cohere client
     * @private
     */
    _initCohere(): Promise<void>;
    /**
     * Generate embedding using local ONNX model
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    _embedLocal(text: any): Promise<unknown[]>;
    /**
     * Generate embedding using Ollama API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    _embedOllama(text: any): Promise<any>;
    /**
     * Generate embedding using OpenAI API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    _embedOpenAI(text: any): Promise<any>;
    /**
     * Generate embedding using Cohere API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    _embedCohere(text: any): Promise<any>;
    /**
     * Normalize vector to unit length
     * @param {number[]} vector - Vector to normalize
     * @returns {number[]} Normalized vector
     * @private
     */
    _normalize(vector: any): any;
    /**
     * Generate cache key from text
     * @param {string} text - Text to generate key from
     * @returns {string} Cache key
     * @private
     */
    _getCacheKey(text: any): string;
    _setCache(key: any, value: any): void;
    /**
     * Get service statistics
     * @returns {Object} Statistics object
     */
    getStats(): {
        modelType: any;
        modelName: any;
        dimension: any;
        initialized: any;
        totalEmbeddings: any;
        cacheHits: any;
        cacheMisses: any;
        cacheSize: any;
        cacheMaxSize: any;
        cacheHitRate: number;
        batchCount: any;
        batchSize: any;
        normalize: any;
    };
    /**
     * Clear the embedding cache
     */
    clearCache(): void;
    /**
     * Reset statistics
     */
    resetStats(): void;
}
export default EmbeddingService;
