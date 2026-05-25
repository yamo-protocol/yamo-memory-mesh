/**
 * S-MORA Layer 0 Scrubber - Stage 2: Semantic Filtering
 * @module smora/scrubber/stages/semantic-filter
 */
import { PatternMatcher } from '../utils/pattern-matcher.js';
import { HashUtil } from '../utils/hash.js';
import { SemanticConfig } from '../config/defaults.js';
export declare class SemanticFilter {
    config: SemanticConfig;
    patternMatcher: PatternMatcher;
    hashUtil: HashUtil;
    constructor(config?: SemanticConfig);
    /**
     * Filter semantically empty content
     * @param {string} content - Cleaned content
     * @returns {Promise<string>} - Filtered content
     */
    filter(content: string): Promise<string>;
    _isBoilerplate(paragraph: string): boolean;
    _removeDuplicates(paragraphs: string[]): Promise<string[]>;
    _hasSignal(paragraph: string): boolean;
}
