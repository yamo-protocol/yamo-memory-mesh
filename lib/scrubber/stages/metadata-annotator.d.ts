/**
 * S-MORA Layer 0 Scrubber - Stage 5: Metadata Annotation
 * @module smora/scrubber/stages/metadata-annotator
 */
import { HashUtil } from '../utils/hash.js';
export declare class MetadataAnnotator {
    config: any;
    hashUtil: HashUtil;
    constructor(config: any);
    /**
     * Add metadata to chunks
     * @param {Array} chunks - Array of chunks
     * @param {Object} document - Original document metadata
     * @returns {Promise<Array>} - Annotated chunks
     */
    annotate(chunks: any[], document: any): Promise<any[]>;
    _extractSection(chunk: any): any;
    _buildHeadingPath(chunk: any, currentPath: string[]): string[];
    _isSubHeading(heading1: string, heading2: string): boolean;
}
