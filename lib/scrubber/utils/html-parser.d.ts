/**
 * HTML Parsing Utilities
 * @module smora/scrubber/utils/html-parser
 */
export declare class HTMLParser {
    /**
     * Extract text content from HTML
     * @param {string} html - HTML content
     * @returns {string} - Extracted text
     */
    parse(html: any): any;
    _extractText(html: any): any;
    _stripTags(html: any): any;
}
