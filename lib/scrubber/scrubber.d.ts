/**
 * S-MORA Layer 0 Scrubber - Main Orchestrator
 * @module smora/scrubber/scrubber
 */
import { StructuralCleaner } from "./stages/structural-cleaner.js";
import { SemanticFilter } from "./stages/semantic-filter.js";
import { Normalizer } from "./stages/normalizer.js";
import { Chunker } from "./stages/chunker.js";
import { MetadataAnnotator } from "./stages/metadata-annotator.js";
import { Validator } from "./stages/validator.js";
export declare class Scrubber {
    config: any;
    stages: any;
    telemetry: any;
    constructor(config?: {});
    /**
     * Main entry point - process a raw document
     * @param {Object} document - { content: string, source: string, type: 'html'|'md'|'txt' }
     * @returns {Promise<Object>} - { chunks: Array, metadata: Object, telemetry: Object }
     */
    process(document: any): Promise<{
        chunks: any[];
        metadata: {
            source: any;
            type: any;
            processingTimestamp: string;
        };
        telemetry: {};
    }>;
    _executeStage(stageName: any, stageFn: any): Promise<any>;
    _initializeStages(): {
        structural: StructuralCleaner;
        semantic: SemanticFilter;
        normalizer: Normalizer;
        chunker: Chunker;
        metadata: MetadataAnnotator;
        validator: Validator;
    };
    getMetrics(): any;
    healthCheck(): Promise<{
        status: string;
    }>;
}
export default Scrubber;
