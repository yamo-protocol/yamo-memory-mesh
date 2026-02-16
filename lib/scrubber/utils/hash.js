// @ts-nocheck
/**
 * Content Hashing Utilities
 * @module smora/scrubber/utils/hash
 */
import crypto from 'crypto';
export class HashUtil {
    /**
     * Hash content for deduplication
     * @param {string} content - Content to hash
     * @returns {string} - SHA256 hash
     */
    hash(content) {
        const normalized = content
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
        return crypto
            .createHash('sha256')
            .update(normalized)
            .digest('hex');
    }
    /**
     * Fast hash for caching (non-cryptographic)
     * @param {string} content - Content to hash
     * @returns {string} - Simple hash
     */
    fastHash(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }
}
