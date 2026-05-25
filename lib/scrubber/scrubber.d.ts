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
import { ScrubberTelemetry } from "./telemetry.js";
import { ScrubberConfig } from "./config/defaults.js";
export declare class Scrubber {
    config: ScrubberConfig;
    stages: {
        structural: StructuralCleaner;
        semantic: SemanticFilter;
        normalizer: Normalizer;
        chunker: Chunker;
        metadata: MetadataAnnotator;
        validator: Validator;
    };
    telemetry: ScrubberTelemetry;
    constructor(config?: ScrubberConfig);
    /**
     * Main entry point - process a raw document
     * @param {Object} document - { content: string, source: string, type: 'html'|'md'|'txt' }
     * @returns {Promise<Object>} - { chunks: Array, metadata: Object, telemetry: Object }
     */
    process(document: {
        content: string;
        source?: string;
        type?: string;
        documentContext?: string;
    }): Promise<{
        chunks: any[];
        metadata: {
            source: any;
            type: any;
            processingTimestamp: string;
        };
        telemetry: Record<string, any>;
        success?: boolean;
        error?: string;
    }>;
    _executeStage(stageName: string, stageFn: () => Promise<any>): Promise<any>;
    _initializeStages(): {
        structural: StructuralCleaner;
        semantic: SemanticFilter;
        normalizer: Normalizer;
        chunker: Chunker;
        metadata: MetadataAnnotator;
        validator: Validator;
    };
    getMetrics(): {
        stages: Record<string, {
            count: number;
            totalTime: number;
            errors: number;
        }>;
        performance: {
            structural: number;
            semantic: number;
            normalization: number;
            chunking: number;
            metadata: number;
            validation: number;
            total: number;
        };
    };
    healthCheck(): Promise<{
        status: string;
    }>;
}
export default Scrubber;
