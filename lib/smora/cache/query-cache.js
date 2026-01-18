/**
 * LRU Cache with TTL for S-MORA Query Results
 * Provides in-memory caching with automatic expiration and eviction
 * @module smora/cache/query-cache
 */

/**
 * LRU Cache with TTL-based expiration
 */
export class QueryCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 100;
    this.ttl = options.ttl || 300000; // 5 minutes default
    this.cache = new Map();
    this.accessOrder = []; // Track LRU access order
    this.timers = new Map(); // TTL cleanup timers
  }

  /**
   * Get current cache size
   * @returns {number} Number of entries
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Store value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to store
   */
  set(key, value) {
    // Evict oldest if at capacity (and not updating existing key)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldest = this.accessOrder.shift();
      this.cache.delete(oldest);
      this._clearTimer(oldest);
    }

    // Remove old entry if updating existing key
    if (this.cache.has(key)) {
      const idx = this.accessOrder.indexOf(key);
      this.accessOrder.splice(idx, 1);
      this._clearTimer(key);
    }

    // Store new entry with timestamp
    this.cache.set(key, { value, timestamp: Date.now() });
    this.accessOrder.push(key);

    // Set TTL expiration timer
    const timer = setTimeout(() => this.delete(key), this.ttl);
    this.timers.set(key, timer);
  }

  /**
   * Retrieve value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if not found/expired
   */
  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }

    const entry = this.cache.get(key);

    // Update access order (most recently used)
    const idx = this.accessOrder.indexOf(key);
    this.accessOrder.splice(idx, 1);
    this.accessOrder.push(key);

    return entry.value;
  }

  /**
   * Remove entry from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) {
      this.accessOrder.splice(idx, 1);
    }
    this._clearTimer(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Internal: Clear TTL timer for key
   * @param {string} key - Cache key
   */
  _clearTimer(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }
}
