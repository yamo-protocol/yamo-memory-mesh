/**
 * S-MORA Layer 0 Scrubber - Stage 6: Validation
 * @module smora/scrubber/stages/validator
 */
export declare class Validator {
    constructor(config: any);
    /**
     * Validate chunks
     * @param {Array} chunks - Array of chunks
     * @returns {Promise<Array>} - Validated chunks
     */
    validate(chunks: any): Promise<any[]>;
    _validateChunk(chunk: any): {
        valid: boolean;
        errors: any[];
    };
}
