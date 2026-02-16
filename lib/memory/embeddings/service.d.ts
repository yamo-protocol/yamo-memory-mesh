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
    embed(text: any, _options?: {}): Promise<any>;
    /**
     * Generate embeddings for a batch of texts
     * @param {string[]} texts - Array of texts to embed
     * @param {Object} options - Options for embedding generation
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    embedBatch(texts: any, _options?: {}): Promise<any[]>;
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
