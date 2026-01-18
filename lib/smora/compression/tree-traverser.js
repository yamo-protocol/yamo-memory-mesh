/**
 * Tree Traverser for Summary Navigation
 *
 * Navigates and queries summary tree structures
 * for efficient context retrieval.
 *
 * @module smora/compression/tree-traverser
 */

/**
 * Tree Traverser for Context Compression
 *
 * Provides navigation and query capabilities
 * for summary tree structures.
 */
export class TreeTraverser {
  constructor(options = {}) {
    this.config = {
      defaultMaxDepth: options.defaultMaxDepth || 2,
      preferSummaries: options.preferSummaries !== false,
      ...options
    };

    this.metrics = {
      traversals: 0,
      nodesVisited: 0
    };
  }

  /**
   * Find relevant nodes in tree based on query embedding
   *
   * @param {Object} tree - Summary tree
   * @param {Array} queryEmbedding - Query vector
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Relevant nodes
   */
  async findRelevantNodes(tree, queryEmbedding, options = {}) {
    const {
      maxDepth = this.config.defaultMaxDepth,
      maxResults = 10,
      minSimilarity = 0.3
    } = options;

    this.metrics.traversals++;
    const nodes = [];

    // Start from root
    const rootSummary = tree.summaries.find(s => s.level === 2);
    if (!rootSummary) {
      // No root summary, return chunks
      return tree.chunks.slice(0, maxResults);
    }

    // Calculate similarity to root
    const rootSimilarity = this._cosineSimilarity(queryEmbedding, rootSummary.vector);
    this.metrics.nodesVisited++;

    if (rootSimilarity >= minSimilarity && maxDepth >= 2) {
      // Root is relevant, check sections
      const sections = tree.summaries.filter(s => s.level === 1);
      for (const section of sections) {
        const similarity = this._cosineSimilarity(queryEmbedding, section.vector);
        this.metrics.nodesVisited++;

        if (similarity >= minSimilarity && maxDepth >= 1) {
          // Section is relevant, include its chunks
          const chunks = this.getChildren(tree, section.id);
          for (const chunk of chunks) {
            const chunkSimilarity = this._cosineSimilarity(queryEmbedding, chunk.vector);
            this.metrics.nodesVisited++;

            if (chunkSimilarity >= minSimilarity) {
              nodes.push({
                ...chunk,
                similarity: chunkSimilarity,
                path: [rootSummary.id, section.id, chunk.id]
              });
            }
          }
        } else if (similarity >= minSimilarity) {
          nodes.push({
            ...section,
            similarity,
            path: [rootSummary.id, section.id]
          });
        }
      }
    } else if (rootSimilarity >= minSimilarity) {
      nodes.push({
        ...rootSummary,
        similarity: rootSimilarity,
        path: [rootSummary.id]
      });
    }

    // Sort by similarity and limit
    nodes.sort((a, b) => b.similarity - a.similarity);
    return nodes.slice(0, maxResults);
  }

  /**
   * Get node by path
   *
   * @param {Object} tree - Summary tree
   * @param {string} path - Node path (e.g., '/0/1')
   * @returns {Object|null} Node or null
   */
  getNodeByPath(tree, path) {
    if (path === '/') {
      // Root path
      return tree.summaries.find(s => s.level === 2) || null;
    }

    const parts = path.split('/').filter(p => p !== '');

    if (parts.length === 1) {
      // Chunk path
      const index = parseInt(parts[0], 10);
      return tree.chunks[index] || null;
    }

    return null;
  }

  /**
   * Get children of a node
   *
   * @param {Object} tree - Summary tree
   * @param {string} nodeId - Node ID
   * @returns {Array} Child nodes
   */
  getChildren(tree, nodeId) {
    // Find the node
    const allNodes = [...tree.chunks, ...tree.summaries];
    const node = allNodes.find(n => n.id === nodeId);

    if (!node || !node.childrenIds || node.childrenIds.length === 0) {
      return [];
    }

    return allNodes.filter(n => node.childrenIds.includes(n.id));
  }

  /**
   * Get parent of a node
   *
   * @param {Object} tree - Summary tree
   * @param {string} nodeId - Node ID
   * @returns {Object|null} Parent node
   */
  getParent(tree, nodeId) {
    // Find the node
    const allNodes = [...tree.chunks, ...tree.summaries];
    const node = allNodes.find(n => n.id === nodeId);

    if (!node || !node.parentId) {
      return null;
    }

    return allNodes.find(n => n.id === node.parentId) || null;
  }

  /**
   * Get path from node to root
   *
   * @param {Object} tree - Summary tree
   * @param {string} nodeId - Node ID
   * @returns {Array} Path to root (root first)
   */
  getPathToRoot(tree, nodeId) {
    const path = [];
    let currentNode = tree.summaries.find(s => s.id === nodeId) ||
                     tree.chunks.find(c => c.id === nodeId);

    while (currentNode) {
      path.unshift(currentNode);
      if (!currentNode.parentId) break;
      currentNode = this.getParent(tree, currentNode.id);
    }

    return path;
  }

  /**
   * Calculate cosine similarity between two vectors
   *
   * @private
   * @param {Array} a - First vector
   * @param {Array} b - Second vector
   * @returns {number} Cosine similarity
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Get traverser metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      config: {
        defaultMaxDepth: this.config.defaultMaxDepth,
        preferSummaries: this.config.preferSummaries
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      traversals: 0,
      nodesVisited: 0
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
 * Custom error class for tree traverser operations
 */
export class TreeTraverserError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TreeTraverserError';
    this.details = details;
  }
}

export default TreeTraverser;
