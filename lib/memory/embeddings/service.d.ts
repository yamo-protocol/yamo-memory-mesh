/**
 * EmbeddingService - Multi-provider embedding generation service
 *
 * Supports:
 * - Local models: Xenova/Transformers.js (ONNX runtime)
 * - Ollama: Local Ollama embeddings API
 * - API models: OpenAI, Cohere
 *
 * Implements TDD for Phase 3, Task 3.1 - Embedding Service Architecture
 */
/**
 * Service configuration interface
 */
export interface ServiceConfig {
    modelType?: "local" | "ollama" | "openai" | "cohere";
    modelName?: string;
    baseUrl?: string;
    dimension?: number;
    batchSize?: number;
    normalize?: boolean;
    cacheMaxSize?: number;
    apiKey?: string;
    priority?: number;
}
export interface ServiceStats {
    modelType: string;
    modelName: string;
    dimension: number;
    initialized: boolean;
    totalEmbeddings: number;
    cacheHits: number;
    cacheMisses: number;
    cacheSize: number;
    cacheMaxSize: number;
    cacheHitRate: number;
    batchCount: number;
    batchSize: number;
    normalize: boolean;
}
/**
 * EmbeddingService provides a unified interface for generating text embeddings
 * using multiple backend providers (local ONNX models or cloud APIs).
 */
export declare class EmbeddingService {
    modelType: string;
    modelName: string;
    baseUrl: string;
    dimension: number;
    batchSize: number;
    normalize: boolean;
    apiKey?: string;
    model: any;
    cache: Map<string, number[]>;
    cacheMaxSize: number;
    initialized: boolean;
    stats: {
        totalEmbeddings: number;
        cacheHits: number;
        cacheMisses: number;
        batchCount: number;
    };
    /**
     * Create a new EmbeddingService instance
     * @param {Object} [config={}] - Configuration options
     */
    constructor(config?: ServiceConfig);
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
    embed(text: string, _options?: any): Promise<number[]>;
    /**
     * Generate embeddings for a batch of texts
     * @param {string[]} texts - Array of texts to embed
     * @param {Object} options - Options for embedding generation
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    embedBatch(texts: string[], _options?: any): Promise<number[][]>;
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
    _embedLocal(text: string): Promise<number[]>;
    /**
     * Generate embedding using Ollama API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    _embedOllama(text: string): Promise<number[]>;
    /**
     * Generate embedding using OpenAI API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    _embedOpenAI(text: string): Promise<number[]>;
    /**
     * Generate embedding using Cohere API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    _embedCohere(text: string): Promise<number[]>;
    /**
     * Normalize vector to unit length
     * @param {number[]} vector - Vector to normalize
     * @returns {number[]} Normalized vector
     * @private
     */
    _normalize(vector: number[]): number[];
    /**
     * Generate cache key from text
     * @param {string} text - Text to generate key from
     * @returns {string} Cache key
     * @private
     */
    _getCacheKey(text: string): string;
    _setCache(key: string, value: number[]): void;
    /**
     * Get service statistics
     * @returns {Object} Statistics object
     */
    getStats(): ServiceStats;
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
