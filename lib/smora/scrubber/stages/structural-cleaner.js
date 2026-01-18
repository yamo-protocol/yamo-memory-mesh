/**
 * S-MORA Layer 0 Scrubber - Stage 1: Structural Cleaning
 * @module smora/scrubber/stages/structural-cleaner
 */

import { HTMLParser } from '../utils/html-parser.js';
import { StructuralCleaningError } from '../errors/scrubber-error.js';

export class StructuralCleaner {
  constructor(config) {
    this.config = config;
    this.htmlParser = new HTMLParser();
  }

  /**
   * Clean document structure
   * @param {string} content - Raw document content
   * @returns {Promise<string>} - Cleaned content
   */
  async clean(content) {
    try {
      const type = this._detectType(content);
      let cleaned = content;

      if (type === 'html') {
        cleaned = await this._cleanHTML(cleaned);
        // HTML may have markdown headings, normalize them
        cleaned = await this._cleanMarkdown(cleaned);
      } else if (type === 'markdown') {
        cleaned = await this._cleanMarkdown(cleaned);
      }

      cleaned = this._collapseWhitespace(cleaned);
      cleaned = this._normalizeLineBreaks(cleaned);

      return cleaned;
    } catch (error) {
      throw new StructuralCleaningError(
        `Failed to clean content: ${error.message}`,
        { originalError: error }
      );
    }
  }

  _detectType(content) {
    if (content.trim().startsWith('<')) return 'html';
    if (/^#{1,6}\s/.test(content) || /^#{1,6}[A-Za-z]/.test(content)) return 'markdown';
    return 'text';
  }

  async _cleanHTML(content) {
    return this.htmlParser.parse(content);
  }

  async _cleanMarkdown(content) {
    let cleaned = content;
    // Add space after heading markers when missing
    cleaned = cleaned.replace(/(#{1,6})([^\s#])/g, '$1 $2');
    // Add space after list markers when missing
    cleaned = cleaned.replace(/(\s*)([-*+])(\S)/g, '$1$2 $3');
    // Add space after numbered list markers when missing
    cleaned = cleaned.replace(/(\s*)(\d+)(\S)/g, (match, ws, num, char) => {
      // Only if it looks like a numbered list (digit followed by non-dot, non-space)
      if (!/\.\s/.test(match.substring(ws.length + num.length))) {
        return `${ws}${num}. ${char}`;
      }
      return match;
    });
    return cleaned;
  }

  _collapseWhitespace(content) {
    let cleaned = content.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned;
  }

  _normalizeLineBreaks(content) {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
}
