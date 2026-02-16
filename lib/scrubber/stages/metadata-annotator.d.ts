/**
 * S-MORA Layer 0 Scrubber - Stage 5: Metadata Annotation
 * @module smora/scrubber/stages/metadata-annotator
 */
export declare class MetadataAnnotator {
    constructor(config: any);
    /**
     * Add metadata to chunks
     * @param {Array} chunks - Array of chunks
     * @param {Object} document - Original document metadata
     * @returns {Promise<Array>} - Annotated chunks
     */
    annotate(chunks: any, document: any): Promise<any>;
    _extractSection(chunk: any): any;
    _buildHeadingPath(chunk: any, currentPath: any): any[];
    _isSubHeading(heading1: any, heading2: any): boolean;
}
