/**
 * S-MORA Layer 0 Scrubber - Stage 1: Structural Cleaning
 * @module smora/scrubber/stages/structural-cleaner
 */
export declare class StructuralCleaner {
    constructor(config: any);
    /**
     * Clean document structure
     * @param {string} content - Raw document content
     * @returns {Promise<string>} - Cleaned content
     */
    clean(content: any): Promise<any>;
    _detectType(content: any): "html" | "markdown" | "text";
    _cleanHTML(content: any): Promise<any>;
    _cleanMarkdown(content: any): Promise<any>;
    _collapseWhitespace(content: any): any;
    _normalizeLineBreaks(content: any): any;
}
