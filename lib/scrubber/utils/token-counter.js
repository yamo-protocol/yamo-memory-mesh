/**
 * Token Counting Utilities
 * @module smora/scrubber/utils/token-counter
 */

export class TokenCounter {
  /**
   * Estimate token count (approximation)
   * @param {string} text - Text to count
   * @returns {number} - Estimated token count
   */
  count(text) {
    // Simple approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * More accurate token count (slower)
   * @param {string} text - Text to count
   * @returns {number} - More accurate token count
   */
  countAccurate(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    let tokens = words.length;
    const punctuationMatches = text.match(/[.,!?;:]/g);
    if (punctuationMatches) {
      tokens += punctuationMatches.length;
    }
    return tokens;
  }
}