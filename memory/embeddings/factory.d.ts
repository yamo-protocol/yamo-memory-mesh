/**
 * EmbeddingFactory - Multi-provider embedding with automatic fallback
 * Manages primary and fallback embedding services
 */
import EmbeddingService, { ServiceConfig, ServiceStats } from "./service.js";
export interface FactoryStats {
    configured: boolean;
    primary: ServiceStats | null;
    fallbacks: ServiceStats[];
}
export interface InitResult {
    success: boolean;
    primary: string | null;
    fallbacks: string[];
}
declare class EmbeddingFactory {
    primaryService: EmbeddingService | null;
    fallbackServices: EmbeddingService[];
    configured: boolean;
    ServiceClass: typeof EmbeddingService;
    constructor(ServiceClass?: typeof EmbeddingService);
    /**
     * Configure embedding services with fallback chain
     * @param {Array} configs - Array of { modelType, modelName, priority, apiKey }
     * @returns {Object} Success status
     */
    configure(configs: ServiceConfig[]): {
        success: boolean;
    };
    /**
     * Initialize all configured services
     * @returns {Promise<Object>} Initialization status
     */
    init(): Promise<InitResult>;
    /**
     * Generate embedding with automatic fallback
     * @param {string} text - Text to embed
     * @param {Object} options - Options
     * @returns {Promise<number[]>} Embedding vector
     */
    embed(text: string, options?: any): Promise<number[]>;
    /**
     * Generate embeddings for batch of texts
     * @param {string[]} texts - Texts to embed
     * @param {Object} options - Options
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    embedBatch(texts: string[], options?: any): Promise<number[][]>;
    /**
     * Get factory statistics
     * @returns {Object} Statistics
     */
    getStats(): FactoryStats;
    /**
     * Clear all caches
     */
    clearCache(): void;
}
export default EmbeddingFactory;
