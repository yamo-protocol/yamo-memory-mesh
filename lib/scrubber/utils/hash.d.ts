export declare class HashUtil {
    /**
     * Hash content for deduplication
     * @param {string} content - Content to hash
     * @returns {string} - SHA256 hash
     */
    hash(content: any): string;
    /**
     * Fast hash for caching (non-cryptographic)
     * @param {string} content - Content to hash
     * @returns {string} - Simple hash
     */
    fastHash(content: any): string;
}
