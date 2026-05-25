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

export const defaultScrubberConfig = {
    // Master switch - enabled by default for security (PII/sensitive data protection)
    enabled: true,
    // Stage 1: Structural Cleaning
    structural: {
        stripHTML: true,
        normalizeMarkdown: true,
        collapseWhitespace: true,
        removeScripts: true,
        removeStyles: true,
    },
    // Stage 2: Semantic Filtering
    semantic: {
        removeDuplicates: true,
        removeBoilerplate: true,
        minSignalRatio: 0.3,
        boilerplatePatterns: "default",
    },
    // Stage 3: Normalization
    normalization: {
        normalizeHeadings: true,
        normalizeLists: true,
        normalizePunctuation: true,
    },
    // Stage 4: Chunking
    chunking: {
        maxTokens: 500,
        minTokens: 10,
        hardMaxTokens: 2000,
        splitOnHeadings: true,
        preserveContext: true,
    },
    // Stage 5: Metadata Annotation
    metadata: {
        addSource: true,
        addSection: true,
        addHeadingPath: true,
        addTimestamp: true,
        addHash: true,
    },
    // Stage 6: Validation
    validation: {
        enforceMinLength: true,
        enforceMaxLength: true,
        rejectEmptyChunks: true,
    },
    // Performance
    logTransformations: false,
    cachePatterns: true,
};
