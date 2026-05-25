/**
 * S-MORA Layer 0 Scrubber - Stage 6: Validation
 * @module smora/scrubber/stages/validator
 */
import { TokenCounter } from '../utils/token-counter.js';
import { ValidationConfig } from '../config/defaults.js';
export declare class Validator {
    config: ValidationConfig;
    tokenCounter: TokenCounter;
    constructor(config?: ValidationConfig);
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
