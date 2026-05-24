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
export declare class Scrubber {
    config: {
        enabled: boolean;
        structural: {
            stripHTML: boolean;
            normalizeMarkdown: boolean;
            collapseWhitespace: boolean;
            removeScripts: boolean;
            removeStyles: boolean;
        };
        semantic: {
            removeDuplicates: boolean;
            removeBoilerplate: boolean;
            minSignalRatio: number;
            boilerplatePatterns: string;
        };
        normalization: {
            normalizeHeadings: boolean;
            normalizeLists: boolean;
            normalizePunctuation: boolean;
        };
        chunking: {
            maxTokens: number;
            minTokens: number;
            hardMaxTokens: number;
            splitOnHeadings: boolean;
            preserveContext: boolean;
        };
        metadata: {
            addSource: boolean;
            addSection: boolean;
            addHeadingPath: boolean;
            addTimestamp: boolean;
            addHash: boolean;
        };
        validation: {
            enforceMinLength: boolean;
            enforceMaxLength: boolean;
            rejectEmptyChunks: boolean;
        };
        logTransformations: boolean;
        cachePatterns: boolean;
    };
    stages: {
        structural: StructuralCleaner;
        semantic: SemanticFilter;
        normalizer: Normalizer;
        chunker: Chunker;
        metadata: MetadataAnnotator;
        validator: Validator;
    };
    telemetry: ScrubberTelemetry;
    constructor(config?: {});
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
