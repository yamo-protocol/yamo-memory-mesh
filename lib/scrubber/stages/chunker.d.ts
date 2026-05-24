/**
 * S-MORA Layer 0 Scrubber - Stage 4: Chunking
 * @module smora/scrubber/stages/chunker
 */
import { TokenCounter } from '../utils/token-counter.js';
export declare class Chunker {
    config: any;
    tokenCounter: TokenCounter;
    constructor(config: any);
    /**
     * Split content into chunks
     * @param {string} content - Normalized content
     * @returns {Promise<Array>} - Array of chunks with metadata
     */
    chunk(content: string, options?: {
        documentContext?: string;
    }): Promise<{
        index: number;
        text: string;
        metadata: {
            tokens: number;
            heading: string | null;
            position: number;
            hasSituatedContext: boolean;
        };
    }[]>;
    _semanticChunk(content: string): Promise<{
        text: string;
        tokens: number;
        heading: string | null;
    }[]>;
    _paragraphChunk(content: string): {
        text: string;
        tokens: number;
        heading: string | null;
    }[];
    _cosineSimilarity(u: number[], v: number[]): number;
    _isHeading(line: string): boolean;
    _shouldStartNewChunk(currentChunk: any, para: string, paraTokens: number, isHeading: boolean): boolean;
    _extractInitialHeading(content: string): string | null;
    _extractHeadingText(headingLine: string): string | null;
}
