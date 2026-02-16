// @ts-nocheck
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
import { ScrubberTelemetry, } from "./telemetry.js";
// import { ScrubberError } from './errors/scrubber-error'; // Assuming this exists or I should check
import { defaultScrubberConfig } from "./config/defaults.js";
export class Scrubber {
    config;
    stages; // Using any for stages as they are not yet converted
    telemetry;
    constructor(config = {}) {
        this.config = { ...defaultScrubberConfig, ...config };
        this.stages = this._initializeStages();
        this.telemetry = new ScrubberTelemetry();
    }
    /**
     * Main entry point - process a raw document
     * @param {Object} document - { content: string, source: string, type: 'html'|'md'|'txt' }
     * @returns {Promise<Object>} - { chunks: Array, metadata: Object, telemetry: Object }
     */
    async process(document) {
        const startTime = Date.now();
        const result = {
            chunks: [],
            metadata: {
                source: document.source,
                type: document.type,
                processingTimestamp: new Date().toISOString(),
            },
            telemetry: {},
        };
        try {
            // If disabled, return empty chunks
            if (!this.config.enabled) {
                result.success = true;
                result.telemetry.totalDuration = Date.now() - startTime;
                return result;
            }
            // Stage 1: Structural Cleaning
            const cleaned = await this._executeStage("structural", () => this.stages.structural.clean(document.content));
            result.telemetry.structural = this.telemetry.getStageStats("structural");
            // Stage 2: Semantic Filtering
            const filtered = await this._executeStage("semantic", () => this.stages.semantic.filter(cleaned));
            result.telemetry.semantic = this.telemetry.getStageStats("semantic");
            // Stage 3: Normalization
            const normalized = await this._executeStage("normalization", () => this.stages.normalizer.normalize(filtered));
            result.telemetry.normalization =
                this.telemetry.getStageStats("normalization");
            // Stage 4: Chunking
            const chunks = await this._executeStage("chunking", () => this.stages.chunker.chunk(normalized));
            result.telemetry.chunking = this.telemetry.getStageStats("chunking");
            // Stage 5: Metadata Annotation
            const annotated = await this._executeStage("metadata", () => this.stages.metadata.annotate(chunks, document));
            result.telemetry.metadata = this.telemetry.getStageStats("metadata");
            // Stage 6: Validation
            result.chunks = await this._executeStage("validation", () => this.stages.validator.validate(annotated));
            result.telemetry.validation = this.telemetry.getStageStats("validation");
            result.telemetry.totalDuration = Date.now() - startTime;
            result.success = true;
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.success = false;
            result.error = message;
            result.telemetry.totalDuration = Date.now() - startTime;
            return result;
        }
    }
    async _executeStage(stageName, stageFn) {
        const startTime = Date.now();
        try {
            const result = await stageFn();
            const duration = Date.now() - startTime;
            this.telemetry.recordStage(stageName, duration, true);
            return result;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            this.telemetry.recordStage(stageName, duration, false);
            throw error;
        }
    }
    _initializeStages() {
        return {
            structural: new StructuralCleaner(this.config.structural),
            semantic: new SemanticFilter(this.config.semantic),
            normalizer: new Normalizer(this.config.normalization),
            chunker: new Chunker(this.config.chunking),
            metadata: new MetadataAnnotator(this.config.metadata),
            validator: new Validator(this.config.validation),
        };
    }
    getMetrics() {
        return this.telemetry.getSummary();
    }
    healthCheck() {
        return Promise.resolve({ status: "healthy" });
    }
}
export default Scrubber;
