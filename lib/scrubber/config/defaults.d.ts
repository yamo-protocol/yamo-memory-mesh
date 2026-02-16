/**
 * S-MORA Layer 0 Scrubber Default Configuration
 * @module smora/scrubber/config/defaults
 */
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
