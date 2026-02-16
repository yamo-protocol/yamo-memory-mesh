// @ts-nocheck
/**
 * S-MORA Layer 0 Scrubber - Stage 6: Validation
 * @module smora/scrubber/stages/validator
 */
import { TokenCounter } from '../utils/token-counter.js';
export class Validator {
    constructor(config) {
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
        if (this.config.enforceMinLength) {
            const tokens = this.tokenCounter.count(chunk.text);
            if (tokens < this.config.minTokens) {
                errors.push(`chunk_too_short: ${tokens} < ${this.config.minTokens}`);
            }
        }
        if (this.config.enforceMaxLength) {
            const tokens = this.tokenCounter.count(chunk.text);
            if (tokens > this.config.hardMaxTokens) {
                errors.push(`chunk_too_long: ${tokens} > ${this.config.hardMaxTokens}`);
            }
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
}
