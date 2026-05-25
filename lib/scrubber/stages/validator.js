/**
 * S-MORA Layer 0 Scrubber - Stage 6: Validation
 * @module smora/scrubber/stages/validator
 */
import { TokenCounter } from '../utils/token-counter.js';
export class Validator {
    config;
    tokenCounter;
    constructor(config = {}) {
        this.config = config;
        this.tokenCounter = new TokenCounter();
    }
    /**
     * Validate chunks
     * @param {Array} chunks - Array of chunks
     * @returns {Promise<Array>} - Validated chunks
     */
    async validate(chunks) {
        const valid = [];
        const errors = [];
        for (const chunk of chunks) {
            const validation = this._validateChunk(chunk);
            if (validation.valid) {
                valid.push(chunk);
            }
            else {
                errors.push({
                    chunkIndex: chunk.index,
                    errors: validation.errors
                });
            }
        }
        return valid;
    }
    _validateChunk(chunk) {
        const errors = [];
        if (this.config.rejectEmptyChunks && !chunk.text.trim()) {
            errors.push('empty_chunk');
        }
        // NOTE: minTokens/hardMaxTokens live under `chunking`, not `validation`, so
        // Scrubber never passes them here — these checks are currently dead (tracked
        // separately). The `!= null` guards preserve that behavior while satisfying
        // strict null checks: when the limit is absent (always, today) the check is skipped.
        if (this.config.enforceMinLength) {
            const tokens = this.tokenCounter.count(chunk.text);
            if (this.config.minTokens != null && tokens < this.config.minTokens) {
                errors.push(`chunk_too_short: ${tokens} < ${this.config.minTokens}`);
            }
        }
        if (this.config.enforceMaxLength) {
            const tokens = this.tokenCounter.count(chunk.text);
            if (this.config.hardMaxTokens != null && tokens > this.config.hardMaxTokens) {
                errors.push(`chunk_too_long: ${tokens} > ${this.config.hardMaxTokens}`);
            }
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
}
