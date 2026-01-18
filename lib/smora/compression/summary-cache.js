/**
 * Summary Cache for Tree Compression
 *
 * Caches computed summaries to avoid regeneration.
 * Optimized for small model contexts.
 *
 * @module smora/compression/summary-cache
 */

/**
 * Summary Cache for Tree Compression
 *
 * LRU cache for storing and retrieving computed
 * summaries and tree structures.
 */
export class SummaryCache {
  constructor(options = {}) {
    this.config = {
      maxSize: options.maxSize || 100,
      maxMemoryMB: options.maxMemoryMB || 50,
      ttl: options.ttl || 3600000, // 1 hour default
      ...options
    };

    // LRU cache: Map where key is the ID, value is {data, timestamp, accessCount}
    this.cache = new Map();

    // Access order tracking for LRU eviction
    this.accessOrder = [];

    // Memory tracking
    this.currentMemoryMB = 0;

    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };
  }

  /**
   * Get a cached tree
   *
   * @param {string} rootId - Tree root ID
   * @returns {Object|null} Cached tree or null
   */
  getTree(rootId) {
    const cached = this._get(rootId);

    if (cached && cached.data && cached.data.chunks) {
      this.metrics.hits++;
      return cached.data;
    }

    this.metrics.misses++;
    return null;
  }

  /**
   * Set a cached tree
   *
   * @param {string} rootId - Tree root ID
   * @param {Object} tree - Tree to cache
   */
  setTree(rootId, tree) {
    this._set(rootId, tree);
  }

  /**
   * Get a cached summary
   *
   * @param {string} nodeId - Node ID
   * @returns {Object|null} Cached summary or null
   */
  getSummary(nodeId) {
    const cached = this._get(`summary:${nodeId}`);

    if (cached && cached.data) {
      this.metrics.hits++;
      return cached.data;
    }

    this.metrics.misses++;
    return null;
  }

  /**
   * Set a cached summary
   *
   * @param {string} nodeId - Node ID
   * @param {Object} summary - Summary to cache
   */
  setSummary(nodeId, summary) {
    this._set(`summary:${nodeId}`, summary);
  }

  /**
   * Get a cached node
   *
   * @param {string} nodeId - Node ID
   * @returns {Object|null} Cached node or null
   */
  getNode(nodeId) {
    const cached = this._get(`node:${nodeId}`);

    if (cached && cached.data) {
      this.metrics.hits++;
      return cached.data;
    }

    this.metrics.misses++;
    return null;
  }

  /**
   * Set a cached node
   *
   * @param {string} nodeId - Node ID
   * @param {Object} node - Node to cache
   */
  setNode(nodeId, node) {
    this._set(`node:${nodeId}`, node);
  }

  /**
   * Internal get method with LRU tracking
   *
   * @private
   * @param {string} key - Cache key
   * @returns {Object|null} Cached entry or null
   */
  _get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this._evict(key);
      return null;
    }

    // Update access order for LRU
    const accessIndex = this.accessOrder.indexOf(key);
    if (accessIndex > -1) {
      this.accessOrder.splice(accessIndex, 1);
    }
    this.accessOrder.push(key);

    return entry;
  }

  /**
   * Internal set method with LRU and memory tracking
   *
   * @private
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   */
  _set(key, data) {
    const size = this._estimateSize(data);

    // Check if we need to evict
    while (
      this.cache.size >= this.config.maxSize ||
      this.currentMemoryMB + size > this.config.maxMemoryMB
    ) {
      if (this.accessOrder.length === 0) break;
      const lruKey = this.accessOrder.shift();
      this._evict(lruKey);
    }

    const entry = {
      data,
      timestamp: Date.now(),
      size
    };

    this.cache.set(key, entry);
    this.accessOrder.push(key);
    this.currentMemoryMB += size;
    this.metrics.size = this.cache.size;
  }

  /**
   * Evict an entry from cache
   *
   * @private
   * @param {string} key - Cache key
   */
  _evict(key) {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentMemoryMB -= entry.size;
      this.metrics.evictions++;
    }
    this.cache.delete(key);
    this.metrics.size = this.cache.size;
  }

  /**
   * Estimate size of cached data in MB
   *
   * @private
   * @param {Object} data - Data to size
   * @returns {number} Size in MB
   */
  _estimateSize(data) {
    const json = JSON.stringify(data);
    const bytes = new Blob([json]).size;
    return bytes / (1024 * 1024);
  }

  /**
   * Check if key exists in cache
   *
   * @param {string} key - Cache key
   * @returns {boolean} True if exists
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
    this.currentMemoryMB = 0;
    this.metrics.size = 0;
  }

  /**
   * Get cache metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      hitRate: this.metrics.hits + this.metrics.misses > 0
        ? this.metrics.hits / (this.metrics.hits + this.metrics.misses)
        : 0,
      currentMemoryMB: this.currentMemoryMB,
      config: {
        maxSize: this.config.maxSize,
        maxMemoryMB: this.config.maxMemoryMB,
        ttl: this.config.ttl
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: this.cache.size
    };
  }

  /**
   * Update configuration
   *
   * @param {Object} options - New configuration options
   */
  updateConfig(options) {
    Object.assign(this.config, options);

    // Trim cache if new limits are lower
    while (
      this.cache.size > this.config.maxSize ||
      this.currentMemoryMB > this.config.maxMemoryMB
    ) {
      if (this.accessOrder.length === 0) break;
      const lruKey = this.accessOrder.shift();
      this._evict(lruKey);
    }
  }
}

/**
 * Custom error class for cache operations
 */
export class SummaryCacheError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SummaryCacheError';
    this.details = details;
  }
}

export default SummaryCache;
