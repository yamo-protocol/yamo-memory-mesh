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
export function getInstructionPrefix(modelName: string): { query: string; passage: string } | null {
    if (!modelName) return null;
    if (process.env.EMBEDDING_INSTRUCTION_PREFIXES === 'off') return null;
    const lower = modelName.toLowerCase();
    // BGE-M3 is trained without instruction prefixes for general use.
    if (lower.includes('bge-m3')) return null;
    // BGE v1.5 family (en + zh): asymmetric query prefix, no passage prefix.
    if (lower.includes('bge-') && lower.includes('v1.5')) {
        return { query: 'Represent this sentence for searching relevant passages: ', passage: '' };
    }
    // E5 family (intfloat): symmetric query / passage prefixes.
    if (lower.includes('/e5-') || lower.includes('multilingual-e5')) {
        return { query: 'query: ', passage: 'passage: ' };
    }
    // Nomic-embed-text v1 / v1.5: task-typed prefixes.
    if (lower.includes('nomic-embed-text')) {
        return { query: 'search_query: ', passage: 'search_document: ' };
    }
    return null;
}
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
    model: any;
    cache;
    cacheMaxSize;
    initialized;
    stats;
    /**
     * Create a new EmbeddingService instance
     * @param {Object} [config={}] - Configuration options
     */
    constructor(config: { modelType?: string; modelName?: string; baseUrl?: string; dimension?: number; batchSize?: number; normalize?: boolean; apiKey?: string; cacheMaxSize?: number } = {}) {
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
    async embed(text: string, options: { isQuery?: boolean; targetDimension?: number } = {}) {
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
        // Apply per-task instruction prefix if the model was trained with one.
        // The prefix lands inside the cached/embedded text so query and passage
        // embeddings of the same content get distinct cache entries naturally.
        const isQuery = !!options.isQuery;
        const prefix = getInstructionPrefix(this.modelName);
        const prefixedText = prefix
            ? (isQuery ? prefix.query : prefix.passage) + text
            : text;
        // Cache key derived from prefixed text → automatically separates
        // query vs passage embeddings without a second cache map.
        const cacheKey = this._getCacheKey(prefixedText);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            this.stats.cacheHits++;
            return this._maybeTruncate(cached, options.targetDimension);
        }
        // Generate embedding
        let embedding;
        try {
            switch (this.modelType) {
                case "local":
                    embedding = await this._embedLocal(prefixedText);
                    break;
                case "ollama":
                    embedding = await this._embedOllama(prefixedText);
                    break;
                case "openai":
                    embedding = await this._embedOpenAI(prefixedText);
                    break;
                case "cohere":
                    embedding = await this._embedCohere(prefixedText);
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
            // Cache the full-dimension embedding so a later request with a
            // different targetDimension can truncate from the same source.
            this._setCache(cacheKey, embedding);
            this.stats.totalEmbeddings++;
            this.stats.cacheMisses++;
            return this._maybeTruncate(embedding, options.targetDimension);
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
     * Matryoshka-style truncation: slice the vector to targetDimension and
     * re-normalize. Matryoshka-trained models (nomic-embed-text-v1.5, Jina-v3,
     * Arctic-embed-l-v2) explicitly support this for storage/latency
     * trade-offs. Non-Matryoshka models tolerate it with some quality loss.
     * @private
     */
    _maybeTruncate(embedding: number[], targetDimension?: number) {
        if (!targetDimension || targetDimension >= embedding.length) {
            return embedding;
        }
        const truncated = embedding.slice(0, targetDimension);
        return this.normalize ? this._normalize(truncated) : truncated;
    }
    /**
     * Generate embeddings for a batch of texts
     * @param {string[]} texts - Array of texts to embed
     * @param {Object} options - Options for embedding generation
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    async embedBatch(texts: any[], options: any = {}) {
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
                // Generate embeddings for batch — forward isQuery/targetDimension
                const batchEmbeddings = await Promise.all(batch.map((text) => this.embed(text, options)));
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
    async embedLateChunked(fullText: string, spans: any[], options: { isQuery?: boolean; targetDimension?: number } = {}) {
        if (!this.initialized) {
            throw new EmbeddingError("Embedding service not initialized. Call init() first.", {
                modelType: this.modelType,
            });
        }
        if (!Array.isArray(spans) || spans.length === 0) return [];
        if (this.modelType !== 'local') return null; // Token-level path is HF/ONNX-only.
        if (typeof fullText !== 'string' || fullText.length === 0) return null;

        const prefix = getInstructionPrefix(this.modelName);
        const isQuery = !!options.isQuery;
        const prefixStr = prefix ? (isQuery ? prefix.query : prefix.passage) : '';
        const prefixedText = prefixStr + fullText;
        const prefixOffset = prefixStr.length;

        let tokenEmbeddings;
        let offsets;
        try {
            // Run the model with NO pooling so we get token-level outputs.
            // Tokenizer offsets are needed to map each token back to characters.
            const output = await this.model(prefixedText, {
                pooling: 'none',
                normalize: false,
            });
            // Output shape: [1, num_tokens, dim]. Extract num_tokens × dim.
            const dims = output.dims;
            if (!Array.isArray(dims) || dims.length !== 3) return null;
            const numTokens = dims[1];
            const dim = dims[2];
            // Flat Float32Array; index of (t, d) is t * dim + d.
            tokenEmbeddings = output.data;
            if (!tokenEmbeddings || tokenEmbeddings.length !== numTokens * dim) return null;

            // Try to get offsets via the underlying tokenizer. transformers.js
            // exposes the tokenizer on the pipeline; not all versions surface
            // return_offsets_mapping. Bail to null if we can't get them.
            const tokenizer = this.model?.tokenizer;
            if (!tokenizer || typeof tokenizer !== 'function' && typeof tokenizer.encode !== 'function') {
                return null;
            }
            const encoded = await (typeof tokenizer === 'function'
                ? tokenizer(prefixedText, { return_offsets_mapping: true })
                : tokenizer.encode(prefixedText, { return_offsets_mapping: true }));
            offsets = encoded?.offset_mapping ?? encoded?.offsets;
            if (!offsets || (Array.isArray(offsets.data) ? offsets.data.length : offsets.length) === 0) {
                return null;
            }
            // Normalize offsets to a flat [(start, end), ...] array of pairs.
            // Tokenizers may emit a 2D tensor (data + dims) or nested arrays.
            if (offsets.dims && Array.isArray(offsets.data)) {
                const flat = offsets.data;
                const pairs = [];
                for (let i = 0; i < numTokens; i++) {
                    pairs.push([Number(flat[i * 2]), Number(flat[i * 2 + 1])]);
                }
                offsets = pairs;
            } else if (!Array.isArray(offsets[0])) {
                return null;
            }

            const result = [];
            for (const span of spans) {
                // Shift span by prefix length since the model saw prefixedText.
                const spanStart = span.start + prefixOffset;
                const spanEnd = span.end + prefixOffset;
                const matchedTokens = [];
                for (let t = 0; t < numTokens; t++) {
                    const [tStart, tEnd] = offsets[t];
                    if (tStart === 0 && tEnd === 0) continue; // [CLS]/[SEP]/[PAD] special tokens
                    // Token overlaps the span if any char of the token is in [spanStart, spanEnd).
                    if (tStart < spanEnd && tEnd > spanStart) {
                        matchedTokens.push(t);
                    }
                }
                if (matchedTokens.length === 0) {
                    // No tokens for this span — degenerate; return a zero vector
                    // (caller can decide to skip the chunk).
                    result.push(new Array(dim).fill(0));
                    continue;
                }
                // Mean-pool the matched tokens
                const sum = new Array(dim).fill(0);
                for (const t of matchedTokens) {
                    const base = t * dim;
                    for (let d = 0; d < dim; d++) sum[d] += tokenEmbeddings[base + d];
                }
                const pooled = sum.map((v) => v / matchedTokens.length);
                result.push(this.normalize ? this._normalize(pooled) : pooled);
            }
            return result;
        } catch (_error) {
            return null;
        }
    }
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
    async embedTokens(text: string, options: { isQuery?: boolean } = {}) {
        if (!this.initialized) {
            throw new EmbeddingError("Embedding service not initialized. Call init() first.", {
                modelType: this.modelType,
            });
        }
        if (typeof text !== 'string' || text.length === 0) return null;
        if (this.modelType !== 'local') return null;
        const prefix = getInstructionPrefix(this.modelName);
        const isQuery = !!options.isQuery;
        const prefixedText = (prefix ? (isQuery ? prefix.query : prefix.passage) : '') + text;
        try {
            const output = await this.model(prefixedText, {
                pooling: 'none',
                normalize: false,
            });
            const dims = output.dims;
            if (!Array.isArray(dims) || dims.length !== 3) return null;
            const numTokens = dims[1];
            const dim = dims[2];
            const raw = output.data;
            if (!raw || raw.length !== numTokens * dim) return null;

            // Tokenizer offsets let us drop special tokens before pooling.
            const tokenizer = this.model?.tokenizer;
            let keepMask: boolean[] | null = null;
            if (tokenizer && (typeof tokenizer === 'function' || typeof tokenizer.encode === 'function')) {
                try {
                    const encoded = await (typeof tokenizer === 'function'
                        ? tokenizer(prefixedText, { return_offsets_mapping: true })
                        : tokenizer.encode(prefixedText, { return_offsets_mapping: true }));
                    let offsets: any = encoded?.offset_mapping ?? encoded?.offsets;
                    if (offsets) {
                        if (offsets.dims && Array.isArray(offsets.data)) {
                            const flat = offsets.data;
                            const pairs: number[][] = [];
                            for (let i = 0; i < numTokens; i++) {
                                pairs.push([Number(flat[i * 2]), Number(flat[i * 2 + 1])]);
                            }
                            offsets = pairs;
                        }
                        if (Array.isArray(offsets) && Array.isArray(offsets[0])) {
                            keepMask = offsets.map(([s, e]: number[]) => !(s === 0 && e === 0));
                        }
                    }
                } catch {
                    // Offsets are optional; without them we keep all tokens.
                }
            }

            // Pack kept tokens into a fresh Float32Array, normalizing each.
            const kept: number[] = [];
            for (let t = 0; t < numTokens; t++) {
                if (keepMask && !keepMask[t]) continue;
                kept.push(t);
            }
            if (kept.length === 0) return null;
            const packed = new Float32Array(kept.length * dim);
            for (let i = 0; i < kept.length; i++) {
                const tIdx = kept[i];
                const srcBase = tIdx * dim;
                const dstBase = i * dim;
                let sumSq = 0;
                for (let d = 0; d < dim; d++) {
                    const v = raw[srcBase + d];
                    packed[dstBase + d] = v;
                    sumSq += v * v;
                }
                if (this.normalize) {
                    const mag = Math.sqrt(sumSq);
                    if (mag > 0) {
                        for (let d = 0; d < dim; d++) packed[dstBase + d] = packed[dstBase + d] / mag;
                    }
                }
            }
            return { data: packed, numTokens: kept.length, dim };
        } catch (_error) {
            return null;
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
                progress_callback: (progress: any) => {
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
    async _embedLocal(text: string) {
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
    async _embedOllama(text: string) {
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
    async _embedOpenAI(text: string) {
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
    async _embedCohere(text: string) {
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
    _normalize(vector: number[]) {
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
    _getCacheKey(text: string) {
        return crypto.createHash("md5").update(text).digest("hex");
    }
    _setCache(key: string, value: any) {
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
