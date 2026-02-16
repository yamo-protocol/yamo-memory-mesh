/**
 * S-MORA Layer 0 Scrubber - Stage 4: Chunking
 * @module smora/scrubber/stages/chunker
 */
export declare class Chunker {
    constructor(config: any);
    /**
     * Split content into chunks
     * @param {string} content - Normalized content
     * @returns {Promise<Array>} - Array of chunks with metadata
     */
    chunk(content: any): Promise<{
        index: number;
        text: any;
        metadata: {
            tokens: any;
            heading: any;
            position: number;
        };
    }[]>;
    _isHeading(line: any): boolean;
    _shouldStartNewChunk(currentChunk: any, para: any, paraTokens: any, isHeading: any): boolean;
    _extractInitialHeading(content: any): any;
    _extractHeadingText(headingLine: any): any;
}
