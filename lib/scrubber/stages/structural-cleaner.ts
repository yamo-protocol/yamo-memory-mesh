/**
 * S-MORA Layer 0 Scrubber - Stage 1: Structural Cleaning
 * @module smora/scrubber/stages/structural-cleaner
 */

import { HTMLParser } from '../utils/html-parser.js';
import { ScrubberError } from '../errors/scrubber-error.js';
import { StructuralConfig } from '../config/defaults.js';

export class StructuralCleaner {
  config: StructuralConfig;
  htmlParser;
  constructor(config: StructuralConfig = {}) {
    this.config = config;
    this.htmlParser = new HTMLParser();
  }

  /**
   * Clean document structure
   * @param {string} content - Raw document content
   * @returns {Promise<string>} - Cleaned content
   */
  async clean(content: string) {
    try {
      let cleaned = this._redactSensitiveData(content);
      const type = this._detectType(cleaned);

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
      const message = error instanceof Error ? error.message : String(error);
      throw new ScrubberError(
        `Failed to clean content: ${message}`,
        { stage: 'structural-cleaner', originalError: error }
      );
    }
  }

  _detectType(content: string) {
    if (content.trim().startsWith('<')) return 'html';
    if (/^#{1,6}\s/.test(content) || /^#{1,6}[A-Za-z]/.test(content)) return 'markdown';
    return 'text';
  }

  async _cleanHTML(content: string) {
    return this.htmlParser.parse(content);
  }

  async _cleanMarkdown(content: string) {
    let cleaned = content;
    // Add space after heading markers when missing
    cleaned = cleaned.replace(/(#{1,6})([^\s#])/g, '$1 $2');
    // Add space after list markers ONLY at line start, and ONLY for genuine
    // single-character markers — negative lookahead (?![*+\-]) prevents
    // **bold** or -- from being split.
    cleaned = cleaned.replace(/^([ \t]*)([-*+])(?![*+\-])([^ \t\n])/gm, '$1$2 $3');
    // Add space after numbered list markers ONLY at line start, ONLY when
    // the digit is followed by a literal dot then a non-space (e.g. "1.Item").
    cleaned = cleaned.replace(/^([ \t]*)(\d+)\.([^ \t\n])/gm, '$1$2. $3');
    return cleaned;
  }

  _collapseWhitespace(content: string) {
    let cleaned = content.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned;
  }

  _normalizeLineBreaks(content: string) {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  _redactSensitiveData(content: string) {
    if (!content) return content;
    let redacted = content;

    // 1. Redact Emails
    redacted = redacted.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '[REDACTED_EMAIL]');

    // 2. Redact IP Addresses (IPv4)
    redacted = redacted.replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '[REDACTED_IP]');

    // 3. Redact Blockchain/Private Keys (64 hex characters, optional 0x prefix)
    redacted = redacted.replace(/\b(?:0x)?[a-fA-F0-9]{64}\b/g, '[REDACTED_SECRET_KEY]');

    // 4. Redact OpenAI/Common API Keys (e.g. sk-...)
    redacted = redacted.replace(/\bsk-[a-zA-Z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]');

    // 5. Redact Bearer Tokens
    redacted = redacted.replace(/\bBearer\s+[a-zA-Z0-9_\-\.\~]{16,}\b/gi, 'Bearer [REDACTED_TOKEN]');

    // 6. Redact Assignment-based Secrets (e.g. PASSWORD = "...", api_key: "...")
    redacted = redacted.replace(/(\b(?:password|passwd|pass|token|secret|api_key|privatekey)\b\s*[:=]\s*(["']?))[a-zA-Z0-9_\-\.\~\@]{12,}(\2)/gi, '$1[REDACTED_SECRET]$3');

    return redacted;
  }
}