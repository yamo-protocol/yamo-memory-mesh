/**
 * S-MORA Layer 0 Scrubber - Stage 3: Normalization
 * @module smora/scrubber/stages/normalizer
 */
export declare class Normalizer {
    constructor(config: any);
    /**
     * Normalize content structure
     * @param {string} content - Filtered content
     * @returns {Promise<string>} - Normalized content
     */
    normalize(content: any): Promise<any>;
    _normalizeHeadings(content: any): any;
    _normalizeLists(content: any): any;
    _normalizePunctuation(content: any): any;
}
