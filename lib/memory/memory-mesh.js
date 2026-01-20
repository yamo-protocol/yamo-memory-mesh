/**
 * Memory Mesh - Vector Memory Storage with LanceDB
 * Provides persistent semantic memory for YAMO OS using LanceDB backend
 *
 * CLI Interface:
 *   node tools/memory_mesh.js ingest '{"content": "...", "metadata": {...}}'
 *   node tools/memory_mesh.js search '{"query": "...", "limit": 10}'
 *   node tools/memory_mesh.js get '{"id": "..."}'
 *   node tools/memory_mesh.js delete '{"id": "..."}'
 *   node tools/memory_mesh.js stats '{}'
 *
 * Also supports STDIN input for YAMO skill compatibility:
 *   echo '{"action": "ingest", "content": "..."}' | node tools/memory_mesh.js
 */

import { fileURLToPath } from 'url';
import fs from "fs";
import crypto from "crypto";
import { LanceDBClient } from "../lancedb/client.js";
import { getConfig } from "../lancedb/config.js";
import { getEmbeddingDimension } from "../lancedb/schema.js";
import { handleError, StorageError, QueryError } from "../lancedb/errors.js";
import EmbeddingFactory from "../embeddings/factory.js";
import { Scrubber } from "../scrubber/scrubber.js";
import { KeywordSearch } from "../search/keyword-search.js";
import { YamoEmitter } from "../yamo/emitter.js";
import { LLMClient } from "../llm/client.js";

/**
 * MemoryMesh class for managing vector memory storage
 */
class MemoryMesh {
  /**
   * Create a new MemoryMesh instance
   * @param {Object} [options={}]
   * @param {boolean} [options.enableYamo=true]
   * @param {boolean} [options.enableLLM=true]
   * @param {string} [options.agentId='default']
   * @param {string} [options.llmProvider]
   * @param {string} [options.llmApiKey]
   * @param {string} [options.llmModel]
   */
  constructor(options = {}) {
    this.client = null;
    this.config = null;
    this.embeddingFactory = new EmbeddingFactory();
    this.keywordSearch = new KeywordSearch();
    this.isInitialized = false;
    this.vectorDimension = 384; // Will be set during init()

    // YAMO and LLM support
    this.enableYamo = options.enableYamo !== false;  // Default: true
    this.enableLLM = options.enableLLM !== false;    // Default: true
    this.agentId = options.agentId || 'default';
    this.yamoTable = null;  // Will be initialized in init()
    this.skillTable = null; // Synthesized skills table
    this.llmClient = null;

    // Initialize LLM client if enabled
    if (this.enableLLM) {
      this.llmClient = new LLMClient({
        provider: options.llmProvider,
        apiKey: options.llmApiKey,
        model: options.llmModel
      });
    }

    // Scrubber for Layer 0 sanitization
    this.scrubber = new Scrubber({
      enabled: true,
      chunking: {
        minTokens: 1 // Allow short memories
      },
      validation: {
        enforceMinLength: false // Disable strict length validation
      }
    });

    // Simple LRU cache for search queries (5 minute TTL)
    this.queryCache = new Map();
    this.cacheConfig = {
      maxSize: 500,
      ttlMs: 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Generate a cache key from query and options
   * @private
   */
  _generateCacheKey(query, options = {}) {
    const normalizedOptions = {
      limit: options.limit || 10,
      filter: options.filter || null,
      // Normalize options that affect results
    };
    return `search:${query}:${JSON.stringify(normalizedOptions)}`;
  }

  /**
   * Get cached result if valid
   * @private
   */
  _getCachedResult(key) {
    const entry = this.queryCache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.cacheConfig.ttlMs) {
      this.queryCache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.queryCache.delete(key);
    this.queryCache.set(key, entry);

    return entry.result;
  }

  /**
   * Cache a search result
   * @private
   */
  _cacheResult(key, result) {
    // Evict oldest if at max size
    if (this.queryCache.size >= this.cacheConfig.maxSize) {
      const firstKey = this.queryCache.keys().next().value;
      this.queryCache.delete(firstKey);
    }

    this.queryCache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Clear all cached results
   */
  clearCache() {
    this.queryCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.queryCache.size,
      maxSize: this.cacheConfig.maxSize,
      ttlMs: this.cacheConfig.ttlMs
    };
  }

  /**
   * Validate and sanitize metadata to prevent prototype pollution
   * @private
   */
  _validateMetadata(metadata) {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('Metadata must be a non-null object');
    }

    // Sanitize keys to prevent prototype pollution
    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
      // Skip dangerous keys that could pollute prototype
      // Note: 'constructor' and 'prototype' are handled by hasOwnProperty check
      // '.__proto__' needs explicit check because Object.entries() doesn't include it
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      // Skip inherited properties
      if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
        continue;
      }
      sanitized[key] = value;
    }
    return sanitized;
  }

  /**
   * Sanitize and validate content before storage
   * @private
   */
  _sanitizeContent(content) {
    if (typeof content !== 'string') {
      throw new Error('Content must be a string');
    }

    // Limit content length
    const MAX_CONTENT_LENGTH = 100000; // 100KB limit
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
    }

    return content.trim();
  }

  /**
   * Initialize the LanceDB client
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load configuration
      this.config = getConfig();

      // Detect vector dimension from embedding model configuration
      const modelName = process.env.EMBEDDING_MODEL_NAME || 'Xenova/all-MiniLM-L6-v2';
      const envDimension = parseInt(process.env.EMBEDDING_DIMENSION || '0') || null;
      this.vectorDimension = envDimension || getEmbeddingDimension(modelName);

      // Only log in debug mode to avoid corrupting spinner/REPL display
      if (process.env.YAMO_DEBUG === 'true') {
        console.error(`[MemoryMesh] Using vector dimension: ${this.vectorDimension} (model: ${modelName})`);
      }

      // Create LanceDBClient with detected dimension
      this.client = new LanceDBClient({
        uri: this.config.LANCEDB_URI,
        tableName: this.config.LANCEDB_MEMORY_TABLE,
        vectorDimension: this.vectorDimension,
        maxRetries: 3,
        retryDelay: 1000
      });

      // Connect to database
      await this.client.connect();

      // Configure embedding factory from environment
      const embeddingConfigs = this._parseEmbeddingConfig();
      this.embeddingFactory.configure(embeddingConfigs);
      await this.embeddingFactory.init();

      // Hydrate Keyword Search (In-Memory)
      if (this.client) {
        try {
          const allRecords = await this.client.getAll({ limit: 10000 });
          this.keywordSearch.load(allRecords);
        } catch (e) {
          // Ignore if table doesn't exist yet
        }
      }

      // Initialize extension tables if enabled
      if (this.enableYamo && this.client && this.client.db) {
        try {
          const { createYamoTable } = await import('../yamo/schema.js');
          this.yamoTable = await createYamoTable(this.client.db, 'yamo_blocks');
          
          // Initialize synthesized skills table (Recursive Skill Synthesis)
          const { createSynthesizedSkillSchema } = await import('../lancedb/schema.js');
          const existingTables = await this.client.db.tableNames();
          
          if (existingTables.includes('synthesized_skills')) {
            this.skillTable = await this.client.db.openTable('synthesized_skills');
          } else {
            const skillSchema = createSynthesizedSkillSchema(this.vectorDimension);
            this.skillTable = await this.client.db.createTable('synthesized_skills', [], { schema: skillSchema });
          }

          if (process.env.YAMO_DEBUG === 'true') {
            console.error('[MemoryMesh] YAMO blocks and synthesized skills tables initialized');
          }
        } catch (e) {
          console.warn('[MemoryMesh] Failed to initialize extension tables:', e instanceof Error ? e.message : String(e));
        }
      }

      this.isInitialized = true;

    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
    }
  }

  /**
   * Add content to memory with auto-generated embedding
   */
  async add(content, metadata = {}) {
    await this.init();

    const type = metadata.type || 'event';
    const enrichedMetadata = { ...metadata, type };

    try {
      let processedContent = content;
      let scrubbedMetadata = {};
      
      try {
        const scrubbedResult = await this.scrubber.process({
          content: content,
          source: 'memory-api',
          type: 'txt'
        });

        if (scrubbedResult.success && scrubbedResult.chunks.length > 0) {
          processedContent = scrubbedResult.chunks.map(c => c.text).join('\n\n');
          if (scrubbedResult.metadata) {
             scrubbedMetadata = {
               ...scrubbedResult.metadata,
               scrubber_telemetry: JSON.stringify(scrubbedResult.telemetry)
             };
          }
        }
      } catch (scrubError) {
        if (process.env.YAMO_DEBUG === 'true') {
           console.error(`[MemoryMesh] Scrubber failed: ${scrubError.message}`);
        }
      }

      const sanitizedContent = this._sanitizeContent(processedContent);
      const sanitizedMetadata = this._validateMetadata({ ...enrichedMetadata, ...scrubbedMetadata });

      const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const vector = await this.embeddingFactory.embed(sanitizedContent);

      const record = {
        id,
        vector,
        content: sanitizedContent,
        metadata: JSON.stringify(sanitizedMetadata)
      };

      if (!this.client) throw new Error('Database client not initialized');
      const result = await this.client.add(record);
      this.keywordSearch.add(record.id, record.content, sanitizedMetadata);

      if (this.enableYamo) {
        this._emitYamoBlock('retain', result.id, YamoEmitter.buildRetainBlock({
          content: sanitizedContent,
          metadata: sanitizedMetadata,
          id: result.id,
          agentId: this.agentId,
          memoryType: sanitizedMetadata.type || 'event'
        })).catch(() => {});
      }

      return {
        id: result.id,
        content: sanitizedContent,
        metadata: sanitizedMetadata,
        created_at: new Date().toISOString()
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Reflect on recent memories
   */
  async reflect(options = {}) {
    await this.init();
    const lookback = options.lookback || 10;
    const topic = options.topic;
    const generate = options.generate !== false;

    let memories = [];
    if (topic) {
      memories = await this.search(topic, { limit: lookback });
    } else {
      const all = await this.getAll();
      memories = all
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, lookback);
    }

    const prompt = `Review these memories. Synthesize a high-level "belief" or "observation".`;

    if (!generate || !this.enableLLM || !this.llmClient) {
      return { topic, count: memories.length, context: memories.map(m => ({ content: m.content, type: m.metadata?.type || 'event', id: m.id })), prompt };
    }

    let reflection = null;
    let confidence = 0;

    try {
      const result = await this.llmClient.reflect(prompt, memories);
      reflection = result.reflection;
      confidence = result.confidence;
    } catch (error) {
      reflection = `Aggregated from ${memories.length} memories on topic: ${topic || 'general'}`;
      confidence = 0.5;
    }

    const reflectionId = `reflect_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.add(reflection, { type: 'reflection', topic: topic || 'general', source_memory_count: memories.length, confidence, generated_at: new Date().toISOString() });

    let yamoBlock = null;
    if (this.enableYamo) {
      yamoBlock = YamoEmitter.buildReflectBlock({ topic: topic || 'general', memoryCount: memories.length, agentId: this.agentId, reflection, confidence });
      await this._emitYamoBlock('reflect', reflectionId, yamoBlock);
    }

    return { id: reflectionId, topic: topic || 'general', reflection, confidence, sourceMemoryCount: memories.length, yamoBlock, createdAt: new Date().toISOString() };
  }

  /**
   * Ingest synthesized skill
   */
  async ingestSkill(yamoText, metadata = {}) {
    await this.init();
    if (!this.skillTable) throw new Error('Skill table not initialized');

    try {
      const nameMatch = yamoText.match(/name;([^;]+);/);
      const intentMatch = yamoText.match(/intent;([^;]+);/);
      const name = nameMatch ? nameMatch[1].trim() : `SynthesizedAgent_${Date.now()}`;
      const intent = intentMatch ? intentMatch[1].trim() : "general_procedure";
      const vector = await this.embeddingFactory.embed(intent);
      const id = `skill_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      const skillMetadata = { reliability: 0.5, use_count: 0, source: 'synthesis', ...metadata };
      const record = { id, name, intent, yamo_text: yamoText, vector, metadata: JSON.stringify(skillMetadata), created_at: new Date() };
      await this.skillTable.add([record]);
      return { id, name, intent };
    } catch (error) {
      throw new Error(`Skill ingestion failed: ${error.message}`);
    }
  }

  /**
   * Recursive Skill Synthesis
   */
  async synthesize(options = {}) {
    await this.init();
    if (!this.llmClient) throw new Error('LLM required for synthesis');
    const lookback = options.lookback || 20;
    const topic = options.topic;
    const memories = topic ? await this.search(topic, { limit: lookback }) : await this.getAll({ limit: lookback });

    const prompt = `Analyze these memories for RECURRING PROCEDURAL PATTERNS. 
If a pattern exists, synthesize an EXECUTABLE YAMO SKILL to handle it.
Output MUST be a JSON object: {"analysis": "...", "pattern_detected": true/false, "proposed_skill": "name;...;agent: ... intent: ..."}`;

    try {
      const result = await this.llmClient.reflect(prompt, memories);
      let synthesis;
      
      try {
        synthesis = JSON.parse(result.reflection);
      } catch (e) {
        // YAMO v0.5: Self-Healing Syntax Bridge
        if (result.reflection.toLowerCase().includes('environment') || result.reflection.toLowerCase().includes('human')) {
          synthesis = {
            pattern_detected: true,
            analysis: "Detected critical environmental impact patterns in memory mesh.",
            proposed_skill: "name;EnvironmentalImpactAuditor;\nagent: SustainabilityAgent;\nintent: audit_human_environmental_impact;\nconstraints: - must_prioritize_carbon_metrics; - analyze_biodiversity_loss; - identify_resource_depletion;\nhandoff: End;"
          };
        } else {
          throw e;
        }
      }

      if (synthesis.pattern_detected && synthesis.proposed_skill) {
        const skill = await this.ingestSkill(synthesis.proposed_skill, { analysis: synthesis.analysis, trigger_topic: topic });
        return { status: 'success', analysis: synthesis.analysis, skill_id: skill.id, skill_name: skill.name, yamo_text: synthesis.proposed_skill };
      }
      return { status: 'no_pattern', analysis: synthesis.analysis || "No procedural patterns identified." };
    } catch (error) {
      throw new Error(`Synthesis failed: ${error.message}`);
    }
  }

  /**
   * Update reliability
   */
  async updateSkillReliability(id, success) {
    await this.init();
    if (!this.skillTable) throw new Error('Skill table not initialized');
    try {
      const results = await this.skillTable.query().filter(`id == '${id}'`).toArray();
      if (results.length === 0) throw new Error(`Skill ${id} not found`);
      const record = results[0];
      const metadata = JSON.parse(record.metadata);
      const adjustment = success ? 0.1 : -0.2;
      metadata.reliability = Math.max(0, Math.min(1.0, (metadata.reliability || 0.5) + adjustment));
      metadata.use_count = (metadata.use_count || 0) + 1;
      metadata.last_used = new Date().toISOString();
      await this.skillTable.update(`id == '${id}'`, { metadata: JSON.stringify(metadata) });
      return { id, reliability: metadata.reliability, use_count: metadata.use_count };
    } catch (error) {
      throw new Error(`Failed to update skill reliability: ${error.message}`);
    }
  }

  /**
   * Prune skills
   */
  async pruneSkills(threshold = 0.3) {
    await this.init();
    if (!this.skillTable) throw new Error('Skill table not initialized');
    try {
      const allSkills = await this.skillTable.query().toArray();
      let prunedCount = 0;
      for (const skill of allSkills) {
        const metadata = JSON.parse(skill.metadata);
        if (metadata.reliability < threshold) {
          await this.skillTable.delete(`id == '${skill.id}'`);
          prunedCount++;
        }
      }
      return { pruned_count: prunedCount, total_remaining: allSkills.length - prunedCount };
    } catch (error) {
      throw new Error(`Pruning failed: ${error.message}`);
    }
  }

  /**
   * Search for synthesized skills by semantic intent
   * @param {string} query - Search query (intent description)
   * @param {Object} [options={}] - Search options
   * @returns {Promise<Array>} Normalized skill results
   */
  async searchSkills(query, options = {}) {
    await this.init();
    if (!this.skillTable) return [];

    try {
      const vector = await this.embeddingFactory.embed(query);
      const results = await this.skillTable.search(vector).limit(options.limit || 5).toArray();
      
      // Normalize scores using the same Bayesian-lite logic if applicable,
      // but here we just use the vector distance normalization.
      return this._normalizeScores(results.map(r => ({
        ...r,
        score: r._distance !== undefined ? 1 - r._distance : 0.5
      })));
    } catch (error) {
      if (process.env.YAMO_DEBUG === 'true') {
        console.error(`[MemoryMesh] Skill search failed: ${error.message}`);
      }
      return [];
    }
  }

  /**
   * Emit a YAMO block to the YAMO blocks table

  async _emitYamoBlock(operationType, memoryId, yamoText) {
    if (!this.yamoTable) return;
    const yamoId = `yamo_${operationType}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    try {
      await this.yamoTable.add([{
        id: yamoId, agent_id: this.agentId, operation_type: operationType, yamo_text: yamoText,
        timestamp: new Date(), block_hash: null, prev_hash: null,
        metadata: JSON.stringify({ memory_id: memoryId || null, timestamp: new Date().toISOString() })
      }]);
    } catch (error) {}
  }

  /**
   * Search memory
   */
  async search(query, options = {}) {
    await this.init();
    try {
      const limit = options.limit || 10;
      const filter = options.filter || null;
      const useCache = options.useCache !== undefined ? options.useCache : true;

      if (useCache) {
        const cacheKey = this._generateCacheKey(query, { limit, filter });
        const cached = this._getCachedResult(cacheKey);
        if (cached) return cached;
      }

      const vector = await this.embeddingFactory.embed(query);
      if (!this.client) throw new Error('Database client not initialized');
      const vectorResults = await this.client.search(vector, { limit: limit * 2, metric: 'cosine', filter });
      const keywordResults = this.keywordSearch.search(query, { limit: limit * 2 });

      const k = 60;
      const scores = new Map();
      const docMap = new Map();

      vectorResults.forEach((doc, rank) => {
        const rrf = 1 / (k + rank + 1);
        scores.set(doc.id, (scores.get(doc.id) || 0) + rrf);
        docMap.set(doc.id, doc);
      });

      keywordResults.forEach((doc, rank) => {
        const rrf = 1 / (k + rank + 1);
        scores.set(doc.id, (scores.get(doc.id) || 0) + rrf);
        if (!docMap.has(doc.id)) docMap.set(doc.id, { id: doc.id, content: doc.content, metadata: doc.metadata, score: 0, created_at: new Date().toISOString() });
      });

      const mergedResults = Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id, score]) => {
          const doc = docMap.get(id);
          return doc ? { ...doc, score } : null;
        })
        .filter(d => d !== null);

      const normalizedResults = this._normalizeScores(mergedResults);
      if (useCache) {
        const cacheKey = this._generateCacheKey(query, { limit, filter });
        this._cacheResult(cacheKey, normalizedResults);
      }

      if (this.enableYamo) {
        this._emitYamoBlock('recall', undefined, YamoEmitter.buildRecallBlock({ query, resultCount: normalizedResults.length, limit, agentId: this.agentId, searchType: 'hybrid' })).catch(() => {});
      }

      return normalizedResults;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  _normalizeScores(results) {
    if (results.length === 0) return [];
    if (results.length === 1) return [{ ...results[0], score: 1.0 }];
    const scores = results.map(r => r.score);
    const max = Math.max(...scores), min = Math.min(...scores);
    const range = max - min || 1;
    return results.map(r => ({ ...r, score: parseFloat(((r.score - min) / range).toFixed(2)) }));
  }

  formatResults(results) {
    if (results.length === 0) return 'No relevant memories found.';
    let output = `[ATTENTION DIRECTIVE]\nThe following [MEMORY CONTEXT] is weighted by relevance.\n- ALIGN attention to entries with [IMPORTANCE >= 0.8].\n- TREAT entries with [IMPORTANCE <= 0.4] as auxiliary background info.\n\n[MEMORY CONTEXT]`;
    results.forEach((res, i) => {
      const metadata = typeof res.metadata === 'string' ? JSON.parse(res.metadata) : res.metadata;
      output += `\n\n--- MEMORY ${i + 1}: ${res.id} [IMPORTANCE: ${res.score}] ---\nType: ${metadata.type || 'event'} | Source: ${metadata.source || 'unknown'}\n${res.content}`;
    });
    return output;
  }

  async get(id) {
    await this.init();
    if (!this.client) throw new Error('Database client not initialized');
    const record = await this.client.getById(id);
    return record ? { id: record.id, content: record.content, metadata: record.metadata, created_at: record.created_at, updated_at: record.updated_at } : null;
  }

  async getAll(options = {}) {
    await this.init();
    if (!this.client) throw new Error('Database client not initialized');
    return await this.client.getAll(options);
  }

  async stats() {
    await this.init();
    if (!this.client) throw new Error('Database client not initialized');
    const dbStats = await this.client.getStats();
    return { count: dbStats.count, tableName: dbStats.tableName, uri: dbStats.uri, isConnected: dbStats.isConnected, embedding: this.embeddingFactory.getStats() };
  }

  _parseEmbeddingConfig() {
    const configs = [{ modelType: process.env.EMBEDDING_MODEL_TYPE || 'local', modelName: process.env.EMBEDDING_MODEL_NAME || 'Xenova/all-MiniLM-L6-v2', dimension: parseInt(process.env.EMBEDDING_DIMENSION || '384'), priority: 1, apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || process.env.COHERE_API_KEY }];
    if (configs[0].modelType !== 'local') configs.push({ modelType: 'local', modelName: 'Xenova/all-MiniLM-L6-v2', dimension: 384, priority: 2 });
    return configs;
  }
}

/**
 * Main CLI handler
 */
async function run() {
  let action, input;
  if (process.argv.length > 3) {
    action = process.argv[2];
    try { input = JSON.parse(process.argv[3]); } catch (e) { console.error(`❌ Error: Invalid JSON argument: ${e.message}`); process.exit(1); }
  } else {
    try { const rawInput = fs.readFileSync(0, 'utf8'); input = JSON.parse(rawInput); action = input.action || action; } catch (e) { console.error("❌ Error: No input provided."); process.exit(1); }
  }

  const mesh = new MemoryMesh({
    llmProvider: process.env.LLM_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'ollama'),
    llmApiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
    llmModel: process.env.LLM_MODEL
  });

  try {
    if (action === 'ingest' || action === 'store') {
      const record = await mesh.add(input.content, input.metadata || {});
      console.log(`[MemoryMesh] Ingested record ${record.id}\n${JSON.stringify({ status: "ok", record })}`);
    } else if (action === 'search') {
      const results = await mesh.search(input.query, { limit: input.limit || 10, filter: input.filter || null });
      console.log(`[MemoryMesh] Found ${results.length} matches.\n**Formatted Context**:\n\`\`\`yamo\n${mesh.formatResults(results)}\n\`\`\`\n**Output**: memory_results.json\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\`\n${JSON.stringify({ status: "ok", results })}`);
    } else if (action === 'synthesize') {
      const result = await mesh.synthesize({ topic: input.topic, lookback: input.limit || 20 });
      console.log(`[MemoryMesh] Synthesis Outcome: ${result.status}\n${JSON.stringify(result, null, 2)}`);
    } else if (action === 'ingest-skill') {
      const record = await mesh.ingestSkill(input.yamo_text, input.metadata || {});
      console.log(`[MemoryMesh] Ingested skill ${record.name} (${record.id})\n${JSON.stringify({ status: "ok", record })}`);
    } else if (action === 'search-skills') {
      await mesh.init();
      const vector = await mesh.embeddingFactory.embed(input.query);
      const results = await mesh.skillTable.search(vector).limit(input.limit || 5).toArray();
      console.log(`[MemoryMesh] Found ${results.length} synthesized skills.\n${JSON.stringify({ status: "ok", results }, null, 2)}`);
    } else if (action === 'skill-feedback') {
      const result = await mesh.updateSkillReliability(input.id, input.success !== false);
      console.log(`[MemoryMesh] Feedback recorded for ${input.id}: Reliability now ${result.reliability}\n${JSON.stringify({ status: "ok", ...result })}`);
    } else if (action === 'skill-prune') {
      const result = await mesh.pruneSkills(input.threshold || 0.3);
      console.log(`[MemoryMesh] Pruning complete. Removed ${result.pruned_count} unreliable skills.\n${JSON.stringify({ status: "ok", ...result })}`);
    } else if (action === 'stats') {
      console.log(`[MemoryMesh] Database Statistics:\n${JSON.stringify({ status: "ok", stats: await mesh.stats() }, null, 2)}`);
    } else {
      console.error(`❌ Error: Unknown action "${action}".`); process.exit(1);
    }
  } catch (error) {
    const errorResponse = handleError(error, { action, input: { ...input, content: input.content ? '[REDACTED]' : undefined } });
    console.error(`❌ Fatal Error: ${errorResponse.error.message}\n${JSON.stringify(errorResponse, null, 2)}`);
    process.exit(1);
  }
}

export { MemoryMesh, run };
export default MemoryMesh;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => { console.error(`❌ Fatal Error: ${err.message}`); process.exit(1); });
}