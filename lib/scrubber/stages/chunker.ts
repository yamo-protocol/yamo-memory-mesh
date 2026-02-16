// @ts-nocheck
/**
 * S-MORA Layer 0 Scrubber - Stage 4: Chunking
 * @module smora/scrubber/stages/chunker
 */

import { TokenCounter } from '../utils/token-counter.js';
import { ChunkingError, ScrubberError } from '../errors/scrubber-error.js';

export class Chunker {
  constructor(config) {
    this.config = config;
    this.tokenCounter = new TokenCounter();
  }

  /**
   * Split content into chunks
   * @param {string} content - Normalized content
   * @returns {Promise<Array>} - Array of chunks with metadata
   */
  async chunk(content) {
    try {
      const chunks = [];
      const paragraphs = content.split(/\n\n+/);

      let currentChunk = {
        text: '',
        tokens: 0,
        heading: this._extractInitialHeading(content)
      };

      for (const para of paragraphs) {
        const isHeading = this._isHeading(para);
        const paraTokens = this.tokenCounter.count(para);

        if (this._shouldStartNewChunk(currentChunk, para, paraTokens, isHeading)) {
          if (currentChunk.tokens >= this.config.minTokens) {
            chunks.push({ ...currentChunk });
          }
          currentChunk = {
            text: '',
            tokens: 0,
            heading: isHeading ? this._extractHeadingText(para) : currentChunk.heading
          };
        }

        currentChunk.text += (currentChunk.text ? '\n\n' : '') + para;
        currentChunk.tokens += paraTokens;

        if (currentChunk.tokens > this.config.hardMaxTokens) {
          chunks.push({ ...currentChunk });
          currentChunk = { text: '', tokens: 0, heading: null };
        }
      }

      if (currentChunk.tokens >= this.config.minTokens) {
        chunks.push(currentChunk);
      }

      return chunks.map((chunk, index) => ({
        index,
        text: chunk.text.trim(),
        metadata: {
          tokens: chunk.tokens,
          heading: chunk.heading,
          position: index
        }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ScrubberError(
        `Failed to chunk content: ${message}`,
        { stage: 'chunker', originalError: error }
      );
    }
  }

  _isHeading(line) {
    return /^#{1,6}\s/.test(line);
  }

  _shouldStartNewChunk(currentChunk, para, paraTokens, isHeading) {
    if (this.config.splitOnHeadings && isHeading && currentChunk.tokens > 0) {
      return true;
    }

    const wouldExceed = (currentChunk.tokens + paraTokens) > this.config.maxTokens;
    if (wouldExceed && currentChunk.tokens > 0) {
      return true;
    }

    return false;
  }

  _extractInitialHeading(content) {
    const match = content.match(/^#{1,6}\s+(.+)$/m);
    return match ? match[1] : null;
  }

  _extractHeadingText(headingLine) {
    const match = headingLine.match(/^#{1,6}\s+(.+)$/);
    return match ? match[1] : null;
  }
}