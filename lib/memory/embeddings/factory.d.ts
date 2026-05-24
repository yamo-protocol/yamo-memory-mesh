/**
 * EmbeddingFactory - Multi-provider embedding with automatic fallback
 * Manages primary and fallback embedding services
 */
import EmbeddingService from "./service.js";
declare class EmbeddingFactory {
    primaryService: any;
    fallbackServices: any[];
    configured: boolean;
    ServiceClass: typeof EmbeddingService;
    primaryServiceFailedUntil: number;
    rerankerModel: any;
    rerankerTokenizer: any;
    constructor(ServiceClass?: typeof EmbeddingService);
    /**
     * Configure embedding services with fallback chain
     * @param {Array} configs - Array of { modelType, modelName, priority, apiKey }
     * @returns {Object} Success status
     */
    configure(configs: any[]): {
        success: boolean;
    };
    /**
     * Initialize all configured services
     * @returns {Promise<Object>} Initialization status
     */
    init(): Promise<{
        success: boolean;
        primary: any;
        fallbacks: any[];
    }>;
    /**
     * Generate embedding with automatic fallback
     * @param {string} text - Text to embed
     * @param {Object} options - Options
     * @returns {Promise<number[]>} Embedding vector
     */
    embed(text: string, options?: any): Promise<any>;
    /**
     * Internal helper to execute fallback embedding chain
     * @private
     */
    _fallbackEmbed(text: string, options: any, primaryErrorMsg: string): Promise<any>;
    /**
     * Generate embeddings for batch of texts
     * @param {string[]} texts - Texts to embed
     * @param {Object} options - Options
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    embedBatch(texts: any[], options?: any): Promise<any>;
    /**
     * Token-level embedding forwarder for ColBERT MaxSim. Returns null if
     * the primary service can't produce token-level outputs.
     */
    embedTokens(text: string, options?: any): Promise<any>;
    /**
     * ColBERT late-interaction rerank: embeds the query at token level,
     * embeds each candidate's content at token level, scores via MaxSim,
     * returns candidates sorted descending by MaxSim score. Each candidate
     * gets a new `_colbertScore` field. Returns the candidates unmodified
     * if the model can't produce token embeddings (caller can detect via
     * the lack of _colbertScore).
     *
     * Cost note: this computes token embeddings on the fly. First call
     * over a candidate set pays per-doc inference; repeats hit the
     * embedding cache. Pre-computed token storage is a future optimization.
     */
    colbertRerank(queryText: string, candidates: any[], options?: {
        normalized?: boolean;
    }): Promise<any[]>;
    /**
     * Late Chunking forwarder — see EmbeddingService.embedLateChunked.
     * Returns null if the primary service can't compute token-level pooled
     * embeddings (callers fall back to per-chunk embed()).
     */
    embedLateChunked(fullText: string, spans: any[], options?: any): Promise<any>;
    /**
     * Get factory statistics
     * @returns {Object} Statistics
     */
    getStats(): {
        configured: boolean;
        primary: any;
        fallbacks: any[];
    };
    /**
     * Clear all caches
     */
    clearCache(): void;
    /**
     * Get tokenizer and sequence classification model for reranking.
     * Model is configurable via RERANKER_MODEL env (default: bge-reranker-base,
     * multilingual XLM-RoBERTa cross-encoder — outperforms the legacy
     * ms-marco-MiniLM-L-6-v2 on BEIR by several nDCG@10 points).
     */
    getReranker(): Promise<{
        tokenizer: any;
        model: any;
    }>;
    /**
     * Compute cross-encoder relevance scores for a query against a set of
     * candidate documents. Tokenization and model inference are batched in a
     * single forward pass per chunk (RERANKER_BATCH_SIZE, default 32) — for
     * typical rerank candidate sets of 20-40, this is one forward pass.
     */
    rerank(query: string, documents: any[]): Promise<number[]>;
}
export default EmbeddingFactory;
