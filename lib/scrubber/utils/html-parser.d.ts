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
    parse(html: string): string;
    _extractText(html: string): string;
    _stripTags(html: string): string;
}
