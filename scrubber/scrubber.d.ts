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
import { ScrubberTelemetry, TelemetrySummary, StageSummary } from "./telemetry.js";
import { ScrubberConfig } from "./config/defaults.js";
export interface ScrubberDocument {
    content: string;
    source: string;
    type: string;
}
export interface Chunk {
    text: string;
    [key: string]: any;
}
export interface ScrubberResult {
    chunks: Chunk[];
    metadata: {
        source: string;
        type: string;
        processingTimestamp: string;
        [key: string]: any;
    };
    telemetry: Partial<Record<string, StageSummary>> & {
        totalDuration?: number;
    };
    success?: boolean;
    error?: string;
}
export declare class Scrubber {
    config: ScrubberConfig;
    stages: any;
    telemetry: ScrubberTelemetry;
    constructor(config?: Partial<ScrubberConfig>);
    /**
     * Main entry point - process a raw document
     * @param {Object} document - { content: string, source: string, type: 'html'|'md'|'txt' }
     * @returns {Promise<Object>} - { chunks: Array, metadata: Object, telemetry: Object }
     */
    process(document: ScrubberDocument): Promise<ScrubberResult>;
    _executeStage<T>(stageName: string, stageFn: () => Promise<T> | T): Promise<T>;
    _initializeStages(): {
        structural: StructuralCleaner;
        semantic: SemanticFilter;
        normalizer: Normalizer;
        chunker: Chunker;
        metadata: MetadataAnnotator;
        validator: Validator;
    };
    getMetrics(): TelemetrySummary;
    healthCheck(): Promise<{
        status: string;
    }>;
}
export default Scrubber;
