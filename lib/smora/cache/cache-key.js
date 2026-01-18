/**
 * Cache Key Generator for S-MORA
 * Generates deterministic cache keys from queries and options
 * @module smora/cache/cache-key
 */

import { createHash } from 'crypto';

/**
 * Generate deterministic cache key from query and options
 * Uses SHA-256 hashing for consistent keys
 *
 * @param {string} query - Search query
 * @param {Object} options - Query options (limit, offset, etc.)
 * @returns {string} Cache key (64-char hex hash)
 */
export function generateCacheKey(query, options = {}) {
  // Normalize query (trim whitespace, lowercase for case-insensitive matching)
  const normalized = query.trim().toLowerCase();

  // Stringify options (ensures deterministic order)
  const optsStr = JSON.stringify(options);

  // Combine query and options
  const combined = `${normalized}:${optsStr}`;

  // Generate SHA-256 hash
  return createHash('sha256')
    .update(combined)
    .digest('hex');
}
