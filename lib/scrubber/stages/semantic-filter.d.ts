/**
 * S-MORA Layer 0 Scrubber - Stage 2: Semantic Filtering
 * @module smora/scrubber/stages/semantic-filter
 */
export declare class SemanticFilter {
    constructor(config: any);
    /**
     * Filter semantically empty content
     * @param {string} content - Cleaned content
     * @returns {Promise<string>} - Filtered content
     */
    filter(content: any): Promise<any>;
    _isBoilerplate(paragraph: any): any;
    _removeDuplicates(paragraphs: any): Promise<any>;
    _hasSignal(paragraph: any): boolean;
}
