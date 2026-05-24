/**
 * S-MORA Layer 0 Scrubber - Stage 6: Validation
 * @module smora/scrubber/stages/validator
 */
import { TokenCounter } from '../utils/token-counter.js';
export declare class Validator {
    config: any;
    tokenCounter: TokenCounter;
    constructor(config: any);
    /**
     * Validate chunks
     * @param {Array} chunks - Array of chunks
     * @returns {Promise<Array>} - Validated chunks
     */
    validate(chunks: any[]): Promise<any[]>;
    _validateChunk(chunk: any): {
        valid: boolean;
        errors: string[];
    };
}
