/**
 * S-MORA Layer 0 Scrubber - Stage 3: Normalization
 * @module smora/scrubber/stages/normalizer
 */
import { NormalizationConfig } from '../config/defaults.js';
export declare class Normalizer {
    config: NormalizationConfig;
    constructor(config?: NormalizationConfig);
    /**
     * Normalize content structure
     * @param {string} content - Filtered content
     * @returns {Promise<string>} - Normalized content
     */
    normalize(content: string): Promise<string>;
    _normalizeHeadings(content: string): string;
    _normalizeLists(content: string): string;
    _normalizePunctuation(content: string): string;
}
