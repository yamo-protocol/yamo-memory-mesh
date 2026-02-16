// @ts-nocheck
/**
 * S-MORA Layer 0 Scrubber Default Configuration
 * @module smora/scrubber/config/defaults
 */
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
