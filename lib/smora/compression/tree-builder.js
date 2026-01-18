/**
 * Tree Builder for Hierarchical Summarization
 *
 * Builds summary trees from documents, enabling efficient
 * context compression for small models.
 *
 * @module smora/compression/tree-builder
 */

/**
 * Tree Builder for Context Compression
 *
 * Creates hierarchical tree structures from documents,
 * organizing chunks into sections and summaries.
 */
export class TreeBuilder {
  constructor(llm, embeddings, options = {}) {
    this.llm = llm;
    this.embeddings = embeddings;

    this.config = {
      maxChunkSize: options.maxChunkSize || 500,
      chunkOverlap: options.chunkOverlap || 50,
      summaryCompressionRatio: options.summaryCompressionRatio || 0.3,
      maxTreeDepth: options.maxTreeDepth || 3,
      sectionSize: options.sectionSize || 5,
      ...options
    };

    this.metrics = {
      treesBuilt: 0,
      chunksCreated: 0,
      summariesCreated: 0,
      avgCompressionRatio: 0
    };
  }

  /**
   * Build a summary tree from a document
   *
   * @param {Object} document - Document to build tree from
   * @param {Object} options - Build options
   * @returns {Promise<Object>} Built tree structure
   */
  async buildTree(document, options = {}) {
    const { content, metadata = {} } = document;
    const rootId = this._generateId();

    // Split into chunks
    const chunks = this._splitIntoChunks(content);

    // Generate embeddings for chunks
    const chunkEmbeddings = await Promise.all(
      chunks.map(chunk => this.embeddings.embed(chunk.text))
    );

    // Build tree structure
    const tree = {
      rootId,
      metadata: {
        ...metadata,
        originalLength: content.length,
        chunkCount: chunks.length,
        createdAt: Date.now()
      },
      chunks: [],
      summaries: []
    };

    // Level 0: Chunks
    for (let i = 0; i < chunks.length; i++) {
      tree.chunks.push({
        id: this._generateId(),
        rootId,
        level: 0,
        chunkType: 'chunk',
        content: chunks[i].text,
        vector: chunkEmbeddings[i],
        summaryPath: `/${i}`,
        parentId: null,
        childrenIds: [],
        originalLength: chunks[i].text.length,
        compressedLength: chunks[i].text.length
      });
    }

    this.metrics.chunksCreated += chunks.length;

    // Level 1: Section summaries
    const sectionGroups = this._groupChunks(chunks, this.config.sectionSize);
    for (let i = 0; i < sectionGroups.length; i++) {
      const sectionChunks = sectionGroups[i];
      const sectionContent = sectionChunks.map(c => c.text).join('\n\n');

      const summary = await this._generateSummary(sectionContent, 'section');
      const summaryEmbedding = await this.embeddings.embed(summary.text);

      const chunkIds = sectionChunks.map((_, idx) =>
        tree.chunks[i * this.config.sectionSize + idx].id
      );

      tree.summaries.push({
        id: this._generateId(),
        rootId,
        level: 1,
        chunkType: 'section',
        content: summary.text,
        vector: summaryEmbedding,
        summaryPath: `/${i}`,
        parentId: rootId,
        childrenIds: chunkIds,
        originalLength: sectionContent.length,
        compressedLength: summary.text.length,
        compressionRatio: summary.text.length / sectionContent.length
      });
    }

    // Level 2: Root summary
    if (tree.summaries.length > 0) {
      const sectionsContent = tree.summaries
        .filter(s => s.level === 1)
        .map(s => s.content)
        .join('\n\n');

      const rootSummary = await this._generateSummary(sectionsContent, 'document');
      const rootEmbedding = await this.embeddings.embed(rootSummary.text);

      const sectionIds = tree.summaries
        .filter(s => s.level === 1)
        .map(s => s.id);

      tree.summaries.push({
        id: rootId,
        rootId,
        level: 2,
        chunkType: 'summary',
        content: rootSummary.text,
        vector: rootEmbedding,
        summaryPath: '/',
        parentId: null,
        childrenIds: sectionIds,
        originalLength: sectionsContent.length,
        compressedLength: rootSummary.text.length,
        compressionRatio: rootSummary.text.length / sectionsContent.length
      });
    }

    this.metrics.treesBuilt++;
    this.metrics.summariesCreated += tree.summaries.length;
    this._updateAvgCompressionRatio(tree);

    return tree;
  }

  /**
   * Split content into chunks
   *
   * @private
   * @param {string} content - Content to split
   * @returns {Array} Chunks with metadata
   */
  _splitIntoChunks(content) {
    // Handle empty content
    if (!content || content.trim().length === 0) {
      return [];
    }

    const chunks = [];
    const words = content.split(/\s+/);
    let currentIndex = 0;

    while (currentIndex < words.length) {
      const chunkWords = words.slice(
        currentIndex,
        currentIndex + this.config.maxChunkSize
      );

      if (chunkWords.length === 0) break;

      chunks.push({
        text: chunkWords.join(' '),
        index: chunks.length,
        startIndex: currentIndex
      });

      currentIndex += this.config.maxChunkSize - this.config.chunkOverlap;
    }

    return chunks;
  }

  /**
   * Group chunks into sections
   *
   * @private
   * @param {Array} chunks - Chunks to group
   * @param {number} size - Group size
   * @returns {Array<Array>} Grouped chunks
   */
  _groupChunks(chunks, size) {
    const groups = [];

    for (let i = 0; i < chunks.length; i += size) {
      groups.push(chunks.slice(i, i + size));
    }

    return groups;
  }

  /**
   * Generate a summary
   *
   * @private
   * @param {string} content - Content to summarize
   * @param {string} level - Summary level ('section' or 'document')
   * @returns {Promise<Object>} Generated summary
   */
  async _generateSummary(content, level) {
    const prompt = level === 'section'
      ? `Write a concise 2-3 sentence summary of the following content:\n\n${content}`
      : `Write a brief 1-2 sentence overview of the following content:\n\n${content}`;

    const maxTokens = Math.ceil(
      content.length / 4 * this.config.summaryCompressionRatio
    );

    const summary = await this.llm.generate(prompt, {
      maxTokens,
      temperature: 0.3
    });

    return {
      text: summary.trim(),
      compressionRatio: summary.length / content.length
    };
  }

  /**
   * Generate unique ID
   *
   * @private
   * @returns {string} Unique ID
   */
  _generateId() {
    return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update average compression ratio
   *
   * @private
   * @param {Object} tree - Built tree
   */
  _updateAvgCompressionRatio(tree) {
    const rootSummary = tree.summaries.find(s => s.level === 2);
    if (!rootSummary) return;

    const alpha = 0.1;
    const currentRatio = rootSummary.compressionRatio || 0;

    this.metrics.avgCompressionRatio = this.metrics.avgCompressionRatio === 0
      ? currentRatio
      : alpha * currentRatio + (1 - alpha) * this.metrics.avgCompressionRatio;
  }

  /**
   * Get builder metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      config: {
        maxChunkSize: this.config.maxChunkSize,
        chunkOverlap: this.config.chunkOverlap,
        summaryCompressionRatio: this.config.summaryCompressionRatio,
        maxTreeDepth: this.config.maxTreeDepth
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      treesBuilt: 0,
      chunksCreated: 0,
      summariesCreated: 0,
      avgCompressionRatio: 0
    };
  }

  /**
   * Update configuration
   *
   * @param {Object} options - New configuration options
   */
  updateConfig(options) {
    Object.assign(this.config, options);
  }
}

/**
 * Custom error class for tree builder operations
 */
export class TreeBuilderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TreeBuilderError';
    this.details = details;
  }
}

export default TreeBuilder;
