/**
 * S-MORA Layer 0 Scrubber - Stage 4: Chunking
 * @module smora/scrubber/stages/chunker
 */

import { TokenCounter } from '../utils/token-counter.js';
import { ScrubberError } from '../errors/scrubber-error.js';
import { ChunkingConfig } from '../config/defaults.js';

export class Chunker {
  config: ChunkingConfig;
  // Token limits are always populated by Scrubber's default-config merge before a
  // Chunker is constructed, so they're asserted non-null here to satisfy strict
  // null checks at the comparison sites below.
  maxTokens: number;
  minTokens: number;
  hardMaxTokens: number;
  tokenCounter;
  constructor(config: ChunkingConfig = {}) {
    this.config = config;
    this.maxTokens = config.maxTokens!;
    this.minTokens = config.minTokens!;
    this.hardMaxTokens = config.hardMaxTokens!;
    this.tokenCounter = new TokenCounter();
  }

  /**
   * Split content into chunks
   * @param {string} content - Normalized content
   * @returns {Promise<Array>} - Array of chunks with metadata
   */
  async chunk(content: string, options: { documentContext?: string } = {}) {
    const { documentContext } = options;
    try {
      let rawChunks;
      if (this.config.embedFn) {
        rawChunks = await this._semanticChunk(content);
      } else {
        rawChunks = this._paragraphChunk(content);
      }

      return rawChunks.map((chunk, index) => {
        let chunkText = chunk.text.trim();
        if (documentContext) {
          chunkText = `[Document Context: ${documentContext.trim()}]\n${chunkText}`;
        }
        return {
          index,
          text: chunkText,
          metadata: {
            tokens: this.tokenCounter.count(chunkText),
            heading: chunk.heading,
            position: index,
            hasSituatedContext: !!documentContext
          }
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ScrubberError(
        `Failed to chunk content: ${message}`,
        { stage: 'chunker', originalError: error }
      );
    }
  }

  async _semanticChunk(content: string) {
    const embedFn = this.config.embedFn;
    if (!embedFn) {
      return this._paragraphChunk(content);
    }

    // 1. Split into sentences/logical lines
    // Headings starting with '#' are kept intact as single elements.
    // Non-headings are split into sentences by standard punctuation boundaries.
    const sentences = content
      .split(/\n+/)
      .flatMap(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
          return [trimmed];
        }
        return trimmed.split(/(?<=[.?!])\s+/);
      })
      .map(s => s.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      return this._paragraphChunk(content);
    }

    // 2. Generate embeddings for all sentences
    const embeddings = await Promise.all(
      sentences.map(sentence => embedFn(sentence))
    );

    // 3. Compute cosine similarities between consecutive sentences
    const similarities = [];
    for (let i = 0; i < sentences.length - 1; i++) {
      similarities.push(this._cosineSimilarity(embeddings[i], embeddings[i + 1]));
    }

    // 4. Calculate threshold dynamically based on mean & std deviation
    let sum = 0;
    for (const sim of similarities) {
      sum += sim;
    }
    const mean = sum / similarities.length;
    let variance = 0;
    for (const sim of similarities) {
      variance += Math.pow(sim - mean, 2);
    }
    const std = Math.sqrt(variance / similarities.length);
    const multiplier = this.config.semanticThresholdMultiplier !== undefined ? this.config.semanticThresholdMultiplier : 0.8;
    const threshold = mean - multiplier * std;

    // 5. Group sentences into chunks based on threshold valleys and token bounds
    const chunks = [];
    let currentChunk = {
      text: '',
      tokens: 0,
      heading: this._extractInitialHeading(content)
    };

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const isHeading = this._isHeading(sentence);
      const sentenceTokens = this.tokenCounter.count(sentence);

      if (i > 0) {
        const simIndex = i - 1;
        const isValley = (simIndex === 0 || similarities[simIndex] < similarities[simIndex - 1]) &&
                         (simIndex === similarities.length - 1 || similarities[simIndex] < similarities[simIndex + 1]);
        const isBelowThreshold = similarities[simIndex] < threshold;
        const isSemanticSplit = isValley && isBelowThreshold;

        const wouldExceedHardMax = (currentChunk.tokens + sentenceTokens) > this.hardMaxTokens;
        const wouldExceedMax = (currentChunk.tokens + sentenceTokens) > this.maxTokens;
        const hasMinTokens = currentChunk.tokens >= this.minTokens;

        let shouldSplit = false;
        if (wouldExceedHardMax) {
          shouldSplit = true;
        } else if (this.config.splitOnHeadings && isHeading && currentChunk.tokens > 0) {
          shouldSplit = true;
        } else if (isSemanticSplit && hasMinTokens) {
          shouldSplit = true;
        } else if (wouldExceedMax && hasMinTokens) {
          shouldSplit = true;
        }

        if (shouldSplit) {
          if (currentChunk.tokens >= this.minTokens) {
            chunks.push({ ...currentChunk });
          }
          currentChunk = {
            text: '',
            tokens: 0,
            heading: isHeading ? this._extractHeadingText(sentence) : currentChunk.heading
          };
        }
      }

      currentChunk.text += (currentChunk.text ? ' ' : '') + sentence;
      currentChunk.tokens += sentenceTokens;
    }

    if (currentChunk.tokens >= this.minTokens) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  _paragraphChunk(content: string) {
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
        if (currentChunk.tokens >= this.minTokens) {
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

      if (currentChunk.tokens > this.hardMaxTokens) {
        chunks.push({ ...currentChunk });
        currentChunk = { text: '', tokens: 0, heading: null };
      }
    }

    if (currentChunk.tokens >= this.minTokens) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  _cosineSimilarity(u: number[], v: number[]) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < u.length; i++) {
      dotProduct += u[i] * v[i];
      normA += u[i] * u[i];
      normB += v[i] * v[i];
    }
    return normA === 0 || normB === 0 ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  _isHeading(line: string) {
    return /^#{1,6}\s/.test(line);
  }

  _shouldStartNewChunk(currentChunk: any, _para: string, paraTokens: number, isHeading: boolean) {
    if (this.config.splitOnHeadings && isHeading && currentChunk.tokens > 0) {
      return true;
    }

    const wouldExceed = (currentChunk.tokens + paraTokens) > this.maxTokens;
    if (wouldExceed && currentChunk.tokens > 0) {
      return true;
    }

    return false;
  }

  _extractInitialHeading(content: string) {
    const match = content.match(/^#{1,6}\s+(.+)$/m);
    return match ? match[1] : null;
  }

  _extractHeadingText(headingLine: string) {
    const match = headingLine.match(/^#{1,6}\s+(.+)$/);
    return match ? match[1] : null;
  }
}