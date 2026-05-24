/**
 * S-MORA Layer 0 Scrubber - Stage 1: Structural Cleaning
 * @module smora/scrubber/stages/structural-cleaner
 */
import { HTMLParser } from '../utils/html-parser.js';
export declare class StructuralCleaner {
    config: any;
    htmlParser: HTMLParser;
    constructor(config: any);
    /**
     * Clean document structure
     * @param {string} content - Raw document content
     * @returns {Promise<string>} - Cleaned content
     */
    clean(content: string): Promise<string>;
    _detectType(content: string): "html" | "markdown" | "text";
    _cleanHTML(content: string): Promise<string>;
    _cleanMarkdown(content: string): Promise<string>;
    _collapseWhitespace(content: string): string;
    _normalizeLineBreaks(content: string): string;
    _redactSensitiveData(content: string): string;
}
