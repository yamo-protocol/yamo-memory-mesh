/**
 * S-MORA Layer 0 Scrubber Default Configuration
 * @module smora/scrubber/config/defaults
 */
/** Stage 1 — structural cleaning flags. */
export interface StructuralConfig {
    stripHTML?: boolean;
    normalizeMarkdown?: boolean;
    collapseWhitespace?: boolean;
    removeScripts?: boolean;
    removeStyles?: boolean;
}
/** Stage 2 — semantic filtering flags. */
export interface SemanticConfig {
    removeDuplicates?: boolean;
    removeBoilerplate?: boolean;
    minSignalRatio?: number;
    boilerplatePatterns?: string;
}
/** Stage 3 — normalization flags. */
export interface NormalizationConfig {
    normalizeHeadings?: boolean;
    normalizeLists?: boolean;
    normalizePunctuation?: boolean;
}
/** Stage 4 — chunking limits. `embedFn` enables semantic chunking when provided. */
export interface ChunkingConfig {
    maxTokens?: number;
    minTokens?: number;
    hardMaxTokens?: number;
    splitOnHeadings?: boolean;
    preserveContext?: boolean;
    semanticThresholdMultiplier?: number;
    embedFn?: (text: string) => Promise<number[]> | number[];
}
/** Stage 5 — metadata annotation flags. */
export interface MetadataConfig {
    addSource?: boolean;
    addSection?: boolean;
    addHeadingPath?: boolean;
    addTimestamp?: boolean;
    addHash?: boolean;
}
/**
 * Stage 6 — validation flags. NOTE: `minTokens`/`hardMaxTokens` are *read* by the
 * Validator but are not part of the validation sub-config that Scrubber passes it
 * (they live under `chunking`), so today they are always undefined and the length
 * checks are dead. Tracked separately; typed here to reflect what the stage reads.
 */
export interface ValidationConfig {
    enforceMinLength?: boolean;
    enforceMaxLength?: boolean;
    rejectEmptyChunks?: boolean;
    minTokens?: number;
    hardMaxTokens?: number;
}
/** Full scrubber config (all optional — merged over {@link defaultScrubberConfig}). */
export interface ScrubberConfig {
    enabled?: boolean;
    structural?: StructuralConfig;
    semantic?: SemanticConfig;
    normalization?: NormalizationConfig;
    chunking?: ChunkingConfig;
    metadata?: MetadataConfig;
    validation?: ValidationConfig;
    logTransformations?: boolean;
    cachePatterns?: boolean;
    embedFn?: (text: string) => Promise<number[]> | number[];
}
export declare const defaultScrubberConfig: {
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
