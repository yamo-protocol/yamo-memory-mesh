// @ts-nocheck
/**
 * S-MORA Layer 0 Scrubber - Stage 5: Metadata Annotation
 * @module smora/scrubber/stages/metadata-annotator
 */

import { HashUtil } from '../utils/hash.js';

export class MetadataAnnotator {
  constructor(config) {
    this.config = config;
    this.hashUtil = new HashUtil();
  }

  /**
   * Add metadata to chunks
   * @param {Array} chunks - Array of chunks
   * @param {Object} document - Original document metadata
   * @returns {Promise<Array>} - Annotated chunks
   */
  async annotate(chunks, document) {
    const headingPath = [];

    return chunks.map((chunk, index) => {
      const metadata = {
        ...chunk.metadata,
        source: this.config.addSource ? document.source : undefined,
        doc_type: this.config.addSource ? document.type : undefined,
        section: this.config.addSection ? this._extractSection(chunk) : undefined,
        heading_path: this.config.addHeadingPath ?
          this._buildHeadingPath(chunk, headingPath) :
          undefined,
        ingestion_timestamp: this.config.addTimestamp ?
          new Date().toISOString() :
          undefined,
        hash: this.config.addHash ?
          this.hashUtil.hash(chunk.text) :
          undefined
      };

      return {
        ...chunk,
        metadata: Object.fromEntries(
          Object.entries(metadata).filter(([_, v]) => v !== undefined)
        )
      };
    });
  }

  _extractSection(chunk) {
    if (chunk.metadata.heading) {
      return chunk.metadata.heading;
    }
    return 'unnamed-section';
  }

  _buildHeadingPath(chunk, currentPath) {
    const heading = chunk.metadata.heading;

    if (heading && heading !== currentPath[currentPath.length - 1]) {
      if (currentPath.length === 0 || this._isSubHeading(heading, currentPath[currentPath.length - 1])) {
        currentPath.push(heading);
      } else {
        currentPath.length = 0;
        currentPath.push(heading);
      }
    }

    return [...currentPath];
  }

  _isSubHeading(heading1, heading2) {
    return heading1.length > heading2.length;
  }
}
