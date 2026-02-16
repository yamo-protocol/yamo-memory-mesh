// @ts-nocheck
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
import crypto from "crypto";
import { ConfigurationError, EmbeddingError } from "../adapters/errors.js";
/**
 * EmbeddingService provides a unified interface for generating text embeddings
 * using multiple backend providers (local ONNX models or cloud APIs).
 */
export class EmbeddingService {
    modelType;
    modelName;
    baseUrl;
    dimension;
    batchSize;
    normalize;
    apiKey;
    model;
    cache;
    cacheMaxSize;
    initialized;
    stats;
    /**
     * Create a new EmbeddingService instance
     * @param {Object} [config={}] - Configuration options
     */
    constructor(config = {}) {
        this.modelType =
            (config && config.modelType) ||
                process.env.EMBEDDING_MODEL_TYPE ||
                "local";
        this.modelName =
            (config && config.modelName) ||
                process.env.EMBEDDING_MODEL_NAME ||
                "Xenova/all-MiniLM-L6-v2";
        this.baseUrl =
            (config && config.baseUrl) ||
                process.env.OLLAMA_BASE_URL ||
                process.env.EMBEDDING_BASE_URL ||
                "http://localhost:11434";
        this.dimension =
            (config && config.dimension) ||
                parseInt(process.env.EMBEDDING_DIMENSION || "384") ||
                384;
        this.batchSize =
            (config && config.batchSize) ||
                parseInt(process.env.EMBEDDING_BATCH_SIZE || "32") ||
                32;
        this.normalize =
            config && config.normalize !== undefined
                ? config.normalize
                : process.env.EMBEDDING_NORMALIZE !== "false";
        this.apiKey = (config && config.apiKey) || process.env.EMBEDDING_API_KEY;
        this.model = null;
        this.cache = new Map();
        this.cacheMaxSize = (config && config.cacheMaxSize) || 1000;
        this.initialized = false;
        // Statistics
        this.stats = {
            totalEmbeddings: 0,
            cacheHits: 0,
            cacheMisses: 0,
            batchCount: 0,
        };
    }
    /**
     * Initialize the embedding model
     * Loads the model based on modelType (local, ollama, openai, cohere)
     */
    async init() {
        try {
            switch (this.modelType) {
                case "local":
                    await this._initLocalModel();
                    break;
                case "ollama":
                    this._initOllama();
                    break;
                case "openai":
                    await this._initOpenAI();
                    break;
                case "cohere":
                    await this._initCohere();
                    break;
                default:
                    throw new ConfigurationError(`Unknown model type: ${this.modelType}. Must be 'local', 'ollama', 'openai', or 'cohere'`, { modelType: this.modelType });
            }
            this.initialized = true;
        }
        catch (error) {
            if (error instanceof ConfigurationError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new EmbeddingError(`Failed to initialize embedding service: ${message}`, {
                modelType: this.modelType,
                modelName: this.modelName,
                originalError: message,
            });
        }
    }
    /**
     * Generate embedding for a single text
     * @param {string} text - Text to embed
     * @param {Object} options - Options for embedding generation
     * @returns {Promise<number[]>} Embedding vector
     */
    async embed(text, _options = {}) {
        if (!this.initialized) {
            throw new EmbeddingError("Embedding service not initialized. Call init() first.", {
                modelType: this.modelType,
            });
        }
        if (!text || typeof text !== "string") {
            throw new EmbeddingError("Text must be a non-empty string", {
                text,
                textType: typeof text,
            });
        }
        // Check cache
        const cacheKey = this._getCacheKey(text);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            this.stats.cacheHits++;
            return cached;
        }
        // Generate embedding
        let embedding;
        try {
            switch (this.modelType) {
                case "local":
                    embedding = await this._embedLocal(text);
                    break;
                case "ollama":
                    embedding = await this._embedOllama(text);
                    break;
                case "openai":
                    embedding = await this._embedOpenAI(text);
                    break;
                case "cohere":
                    embedding = await this._embedCohere(text);
                    break;
                default:
                    throw new EmbeddingError(`Unknown model type: ${this.modelType}`, {
                        modelType: this.modelType,
                    });
            }
            // Normalize if enabled
            if (this.normalize) {
                embedding = this._normalize(embedding);
            }
            // Cache result
            this._setCache(cacheKey, embedding);
            this.stats.totalEmbeddings++;
            this.stats.cacheMisses++;
            return embedding;
        }
        catch (error) {
            if (error instanceof EmbeddingError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new EmbeddingError(`Failed to generate embedding: ${message}`, {
                modelType: this.modelType,
                text: text.substring(0, 100),
            });
        }
    }
    /**
     * Generate embeddings for a batch of texts
     * @param {string[]} texts - Array of texts to embed
     * @param {Object} options - Options for embedding generation
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    async embedBatch(texts, _options = {}) {
        if (!this.initialized) {
            throw new EmbeddingError("Embedding service not initialized. Call init() first.", {
                modelType: this.modelType,
            });
        }
        if (!Array.isArray(texts)) {
            throw new EmbeddingError("Texts must be an array", {
                textsType: typeof texts,
            });
        }
        if (texts.length === 0) {
            return [];
        }
        try {
            const embeddings = [];
            // Process in batches
            for (let i = 0; i < texts.length; i += this.batchSize) {
                const batch = texts.slice(i, Math.min(i + this.batchSize, texts.length));
                // Generate embeddings for batch
                const batchEmbeddings = await Promise.all(batch.map((text) => this.embed(text)));
                embeddings.push(...batchEmbeddings);
                this.stats.batchCount++;
            }
            return embeddings;
        }
        catch (error) {
            if (error instanceof EmbeddingError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new EmbeddingError(`Failed to generate batch embeddings: ${message}`, {
                modelType: this.modelType,
                batchSize: texts.length,
            });
        }
    }
    /**
     * Initialize local ONNX model using Xenova/Transformers.js
     * @private
     */
    async _initLocalModel() {
        try {
            // Dynamic import to allow optional dependency
            const { pipeline } = (await import("@xenova/transformers"));
            // Load feature extraction pipeline
            this.model = await pipeline("feature-extraction", this.modelName, {
                quantized: true,
                progress_callback: (progress) => {
                    // Optional: Log model download progress
                    if (progress.status === "downloading") {
                        // Silently handle progress
                    }
                },
            });
            // Update dimension based on model (384 for all-MiniLM-L6-v2)
            if (this.modelName.includes("all-MiniLM-L6-v2")) {
                this.dimension = 384;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new ConfigurationError(`Failed to load local model: ${message}. Make sure @xenova/transformers is installed.`, { modelName: this.modelName, error: message });
        }
    }
    /**
     * Initialize Ollama client
     * Ollama runs locally and doesn't require authentication
     * @private
     */
    _initOllama() {
        // Ollama doesn't require initialization - it's a local HTTP API
        // Store the base URL for use in _embedOllama
        this.model = {
            baseUrl: this.baseUrl,
            modelName: this.modelName || "nomic-embed-text",
        };
        // Set default dimension for common Ollama embedding models
        if (this.modelName.includes("nomic-embed-text")) {
            this.dimension = 768;
        }
        else if (this.modelName.includes("mxbai-embed")) {
            this.dimension = 1024;
        }
        else if (this.modelName.includes("all-MiniLM")) {
            this.dimension = 384;
        }
    }
    /**
     * Initialize OpenAI client
     * @private
     */
    async _initOpenAI() {
        if (!this.apiKey) {
            throw new ConfigurationError("OpenAI API key is required. Set EMBEDDING_API_KEY environment variable or pass apiKey in config.", { modelType: "openai" });
        }
        try {
            // Dynamic import to allow optional dependency (openai may not be installed)
            const { OpenAI } = await import("openai");
            this.model = new OpenAI({ apiKey: this.apiKey });
            // Update dimension for OpenAI models
            if (this.modelName.includes("text-embedding-ada-002")) {
                this.dimension = 1536;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new ConfigurationError(`Failed to initialize OpenAI client: ${message}. Make sure openai package is installed.`, { error: message });
        }
    }
    /**
     * Initialize Cohere client
     * @private
     */
    async _initCohere() {
        if (!this.apiKey) {
            throw new ConfigurationError("Cohere API key is required. Set EMBEDDING_API_KEY environment variable or pass apiKey in config.", { modelType: "cohere" });
        }
        try {
            // Dynamic import to allow optional dependency (cohere-ai may not be installed)
            const cohere = await import("cohere-ai");
            this.model = new cohere.CohereClient({ token: this.apiKey });
            // Update dimension for Cohere models
            if (this.modelName.includes("embed-english-v3.0")) {
                this.dimension = 1024;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new ConfigurationError(`Failed to initialize Cohere client: ${message}. Make sure cohere-ai package is installed.`, { error: message });
        }
    }
    /**
     * Generate embedding using local ONNX model
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    async _embedLocal(text) {
        if (!this.model) {
            throw new EmbeddingError("Model not initialized");
        }
        try {
            // Local model call
            const output = await this.model(text, {
                pooling: "mean",
                normalize: false,
            });
            // Convert from tensor to array
            const embedding = Array.from(output.data);
            return embedding;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new EmbeddingError(`Failed to generate local embedding: ${message}`, {
                modelName: this.modelName,
                text: text.substring(0, 100),
            });
        }
    }
    /**
     * Generate embedding using Ollama API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    async _embedOllama(text) {
        if (!this.model) {
            throw new EmbeddingError("Model not initialized");
        }
        try {
            const baseUrl = this.model.baseUrl;
            const modelName = this.model.modelName;
            const response = await fetch(`${baseUrl}/api/embeddings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: modelName,
                    prompt: text,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new EmbeddingError(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`, { baseUrl: baseUrl, modelName: modelName });
            }
            const data = await response.json();
            if (!data.embedding) {
                throw new EmbeddingError("Invalid response from Ollama API: missing embedding field", {
                    response: data,
                });
            }
            return data.embedding;
        }
        catch (error) {
            if (error instanceof EmbeddingError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            const baseUrl = this.model?.baseUrl;
            const modelName = this.model?.modelName;
            throw new EmbeddingError(`Failed to generate Ollama embedding: ${message}. Make sure Ollama is running and the model is available.`, { baseUrl, modelName, error: message });
        }
    }
    /**
     * Generate embedding using OpenAI API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    async _embedOpenAI(text) {
        if (!this.model) {
            throw new EmbeddingError("Model not initialized");
        }
        try {
            const response = await this.model.embeddings.create({
                model: this.modelName,
                input: text,
            });
            const embedding = response.data[0].embedding;
            return embedding;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new EmbeddingError(`Failed to generate OpenAI embedding: ${message}`, {
                modelName: this.modelName,
                error: message,
            });
        }
    }
    /**
     * Generate embedding using Cohere API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     * @private
     */
    async _embedCohere(text) {
        if (!this.model) {
            throw new EmbeddingError("Model not initialized");
        }
        try {
            const response = await this.model.embed({
                model: this.modelName,
                texts: [text],
                inputType: "search_document",
            });
            const embedding = response.embeddings[0];
            return embedding;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new EmbeddingError(`Failed to generate Cohere embedding: ${message}`, {
                modelName: this.modelName,
                error: message,
            });
        }
    }
    /**
     * Normalize vector to unit length
     * @param {number[]} vector - Vector to normalize
     * @returns {number[]} Normalized vector
     * @private
     */
    _normalize(vector) {
        // Calculate magnitude
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        // Avoid division by zero
        if (magnitude === 0) {
            return vector.map(() => 0);
        }
        // Normalize
        return vector.map((val) => val / magnitude);
    }
    /**
     * Generate cache key from text
     * @param {string} text - Text to generate key from
     * @returns {string} Cache key
     * @private
     */
    _getCacheKey(text) {
        return crypto.createHash("md5").update(text).digest("hex");
    }
    _setCache(key, value) {
        // Evict oldest if at capacity
        if (this.cache.size >= this.cacheMaxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }
    /**
     * Get service statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        return {
            modelType: this.modelType,
            modelName: this.modelName,
            dimension: this.dimension,
            initialized: this.initialized,
            totalEmbeddings: this.stats.totalEmbeddings,
            cacheHits: this.stats.cacheHits,
            cacheMisses: this.stats.cacheMisses,
            cacheSize: this.cache.size,
            cacheMaxSize: this.cacheMaxSize,
            cacheHitRate: this.stats.cacheHits /
                (this.stats.cacheHits + this.stats.cacheMisses) || 0,
            batchCount: this.stats.batchCount,
            batchSize: this.batchSize,
            normalize: this.normalize,
        };
    }
    /**
     * Clear the embedding cache
     */
    clearCache() {
        this.cache.clear();
    }
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalEmbeddings: 0,
            cacheHits: 0,
            cacheMisses: 0,
            batchCount: 0,
        };
    }
}
export default EmbeddingService;
