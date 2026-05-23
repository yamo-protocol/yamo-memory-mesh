// @ts-nocheck
/**
 * EmbeddingFactory - Multi-provider embedding with automatic fallback
 * Manages primary and fallback embedding services
 */
import EmbeddingService from "./service.js";
import { ConfigurationError, EmbeddingError } from "../adapters/errors.js";
import { createLogger } from "../../utils/logger.js";
const logger = createLogger("embedding-factory");
class EmbeddingFactory {
    primaryService;
    fallbackServices;
    configured;
    ServiceClass;
    primaryServiceFailedUntil;
    constructor(ServiceClass = EmbeddingService) {
        this.primaryService = null;
        this.fallbackServices = [];
        this.configured = false;
        this.ServiceClass = ServiceClass;
        this.primaryServiceFailedUntil = 0;
    }
    /**
     * Configure embedding services with fallback chain
     * @param {Array} configs - Array of { modelType, modelName, priority, apiKey }
     * @returns {Object} Success status
     */
    configure(configs) {
        // Sort by priority (lower = higher priority)
        configs.sort((a, b) => (a.priority || 0) - (b.priority || 0));
        if (configs.length > 0) {
            this.primaryService = new this.ServiceClass(configs[0]);
        }
        if (configs.length > 1) {
            this.fallbackServices = configs
                .slice(1)
                .map((c) => new this.ServiceClass(c));
        }
        this.configured = true;
        return { success: true };
    }
    /**
     * Initialize all configured services
     * @returns {Promise<Object>} Initialization status
     */
    async init() {
        if (!this.configured) {
            throw new ConfigurationError("EmbeddingFactory not configured. Call configure() first.");
        }
        // Initialize primary service
        if (this.primaryService && !this.primaryService.initialized) {
            await this.primaryService.init();
        }
        // Initialize fallback services lazily (on first use)
        return {
            success: true,
            primary: this.primaryService ? this.primaryService.modelName : null,
            fallbacks: this.fallbackServices.map((s) => s.modelName),
        };
    }
    /**
     * Generate embedding with automatic fallback
     * @param {string} text - Text to embed
     * @param {Object} options - Options
     * @returns {Promise<number[]>} Embedding vector
     */
    async embed(text, options = {}) {
        if (!this.configured || !this.primaryService) {
            throw new ConfigurationError("EmbeddingFactory not configured");
        }
        const now = Date.now();
        const primaryHealthy = now > this.primaryServiceFailedUntil;
        if (primaryHealthy) {
            try {
                if (!this.primaryService.initialized) {
                    await this.primaryService.init();
                }
                return await this.primaryService.embed(text, options);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn({ err: error, primaryService: this.primaryService?.modelName }, "Primary service failed. Cooldown active for 60s.");
                this.primaryServiceFailedUntil = Date.now() + 60000;
                return this._fallbackEmbed(text, options, errorMessage);
            }
        }
        else {
            if (process.env.YAMO_DEBUG === "true") {
                logger.debug("Primary service in cooldown. Skipping to fallbacks.");
            }
            return this._fallbackEmbed(text, options, "Primary service in cooldown state");
        }
    }
    /**
     * Internal helper to execute fallback embedding chain
     * @private
     */
    async _fallbackEmbed(text, options, primaryErrorMsg) {
        for (const fallback of this.fallbackServices) {
            try {
                if (!fallback.initialized) {
                    await fallback.init();
                }
                logger.info({ fallbackModel: fallback.modelName }, "Using fallback service");
                return await fallback.embed(text, options);
            }
            catch (fallbackError) {
                logger.warn({ err: fallbackError, fallbackModel: fallback.modelName }, "Fallback service failed");
            }
        }
        throw new EmbeddingError("All embedding services failed", {
            primaryError: primaryErrorMsg,
            fallbackCount: this.fallbackServices.length,
        });
    }
    /**
     * Generate embeddings for batch of texts
     * @param {string[]} texts - Texts to embed
     * @param {Object} options - Options
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    async embedBatch(texts, options = {}) {
        if (!this.configured || !this.primaryService) {
            throw new ConfigurationError("EmbeddingFactory not configured");
        }
        const now = Date.now();
        const primaryHealthy = now > this.primaryServiceFailedUntil;
        if (primaryHealthy) {
            try {
                if (!this.primaryService.initialized) {
                    await this.primaryService.init();
                }
                return await this.primaryService.embedBatch(texts, options);
            }
            catch (error) {
                logger.warn({
                    err: error,
                    primaryService: this.primaryService?.modelName,
                    batchSize: texts.length,
                }, "Primary batch embedding failed. Cooldown active for 60s, falling back to individual embeddings");
                this.primaryServiceFailedUntil = Date.now() + 60000;
                const results = [];
                for (const text of texts) {
                    results.push(await this.embed(text, options));
                }
                return results;
            }
        }
        else {
            if (process.env.YAMO_DEBUG === "true") {
                logger.debug("Primary service in cooldown. Processing batch elements individually.");
            }
            const results = [];
            for (const text of texts) {
                results.push(await this.embed(text, options));
            }
            return results;
        }
    }
    /**
     * Get factory statistics
     * @returns {Object} Statistics
     */
    getStats() {
        const stats = {
            configured: this.configured,
            primary: this.primaryService?.getStats() || null,
            fallbacks: this.fallbackServices.map((s) => s.getStats()),
        };
        return stats;
    }
    /**
     * Clear all caches
     */
    clearCache() {
        this.primaryService?.clearCache();
        this.fallbackServices.forEach((s) => s.clearCache());
    }

    /**
     * Get tokenizer and sequence classification model for reranking
     */
    async getReranker() {
        if (!this.rerankerModel) {
            const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@xenova/transformers");
            const model_id = 'Xenova/ms-marco-MiniLM-L-6-v2';
            this.rerankerTokenizer = await AutoTokenizer.from_pretrained(model_id);
            this.rerankerModel = await AutoModelForSequenceClassification.from_pretrained(model_id);
        }
        return { tokenizer: this.rerankerTokenizer, model: this.rerankerModel };
    }

    /**
     * Compute cross-encoder relevance scores for a query and a set of candidate documents
     */
    async rerank(query, documents) {
        if (!documents || documents.length === 0) {
            return [];
        }
        const { tokenizer, model } = await this.getReranker();
        const scores = [];
        for (const doc of documents) {
            const inputs = await tokenizer(query, { text_pair: doc, padding: true, truncation: true });
            const { logits } = await model(inputs);
            scores.push(logits.data[0]);
        }
        return scores;
    }
}
export default EmbeddingFactory;
