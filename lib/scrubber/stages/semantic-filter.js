/**
 * S-MORA Layer 0 Scrubber - Stage 2: Semantic Filtering
 * @module smora/scrubber/stages/semantic-filter
 */

import { PatternMatcher } from '../utils/pattern-matcher.js';
import { HashUtil } from '../utils/hash.js';

export class SemanticFilter {
  constructor(config) {
    this.config = config;
    this.patternMatcher = new PatternMatcher();
    this.hashUtil = new HashUtil();
  }

  /**
   * Filter semantically empty content
   * @param {string} content - Cleaned content
   * @returns {Promise<string>} - Filtered content
   */
  async filter(content) {
    const paragraphs = content.split(/\n\n+/);

    let filtered = paragraphs.filter(p => !this._isBoilerplate(p));
    filtered = await this._removeDuplicates(filtered);
    filtered = filtered.filter(p => this._hasSignal(p));

    return filtered.join('\n\n');
  }

  _isBoilerplate(paragraph) {
    return this.patternMatcher.isBoilerplate(paragraph);
  }

  async _removeDuplicates(paragraphs) {
    if (!this.config.removeDuplicates) return paragraphs;

    const seen = new Set();
    const unique = [];

    for (const para of paragraphs) {
      const hash = this.hashUtil.hash(para);
      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(para);
      }
    }

    return unique;
  }

  _hasSignal(paragraph) {
    const text = paragraph.trim();
    if (text.length < 10) return false;

    const signalChars = text.replace(/[^a-zA-Z0-9]/g, '').length;
    const ratio = signalChars / text.length;

    return ratio >= (this.config.minSignalRatio || 0.3);
  }
}
