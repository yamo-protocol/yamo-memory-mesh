/**
 * EmbeddingFactory - Multi-provider embedding with automatic fallback
 * Manages primary and fallback embedding services
 */
import EmbeddingService from "./service.js";
declare class EmbeddingFactory {
    primaryService: any;
    fallbackServices: any;
    configured: any;
    ServiceClass: any;
    primaryServiceFailedUntil: any;
    constructor(ServiceClass?: typeof EmbeddingService);
    /**
     * Configure embedding services with fallback chain
     * @param {Array} configs - Array of { modelType, modelName, priority, apiKey }
     * @returns {Object} Success status
     */
    configure(configs: any): {
        success: boolean;
    };
    /**
     * Initialize all configured services
     * @returns {Promise<Object>} Initialization status
     */
    init(): Promise<{
        success: boolean;
        primary: any;
        fallbacks: any;
    }>;
    /**
     * Generate embedding with automatic fallback
     * @param {string} text - Text to embed
     * @param {Object} options - Options
     * @returns {Promise<number[]>} Embedding vector
     */
    embed(text: any, options?: {}): Promise<any>;
    /**
     * Internal helper to execute fallback embedding chain
     * @private
     */
    _fallbackEmbed(text: any, options: any, primaryErrorMsg: any): Promise<any>;
    /**
     * Generate embeddings for batch of texts
     * @param {string[]} texts - Texts to embed
     * @param {Object} options - Options
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    embedBatch(texts: any, options?: {}): Promise<any>;
    /**
     * Get factory statistics
     * @returns {Object} Statistics
     */
    getStats(): {
        configured: any;
        primary: any;
        fallbacks: any;
    };
    /**
     * Clear all caches
     */
    clearCache(): void;
    /**
     * Get tokenizer and sequence classification model for reranking
     */
    getReranker(): Promise<{
        tokenizer: any;
        model: any;
    }>;
    /**
     * Compute cross-encoder relevance scores for a query and a set of candidate documents
     */
    rerank(query: any, documents: any): Promise<any[]>;
}
export default EmbeddingFactory;
