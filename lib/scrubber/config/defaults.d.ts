/**
 * S-MORA Layer 0 Scrubber Default Configuration
 * @module smora/scrubber/config/defaults
 */
export interface StructuralConfig {
    stripHTML: boolean;
    normalizeMarkdown: boolean;
    collapseWhitespace: boolean;
    removeScripts: boolean;
    removeStyles: boolean;
}
export interface SemanticConfig {
    removeDuplicates: boolean;
    removeBoilerplate: boolean;
    minSignalRatio: number;
    boilerplatePatterns: string;
}
export interface NormalizationConfig {
    normalizeHeadings: boolean;
    normalizeLists: boolean;
    normalizePunctuation: boolean;
}
export interface ChunkingConfig {
    maxTokens: number;
    minTokens: number;
    hardMaxTokens: number;
    splitOnHeadings: boolean;
    preserveContext: boolean;
}
export interface MetadataConfig {
    addSource: boolean;
    addSection: boolean;
    addHeadingPath: boolean;
    addTimestamp: boolean;
    addHash: boolean;
}
export interface ValidationConfig {
    enforceMinLength: boolean;
    enforceMaxLength: boolean;
    rejectEmptyChunks: boolean;
}
export interface ScrubberConfig {
    enabled: boolean;
    structural: StructuralConfig;
    semantic: SemanticConfig;
    normalization: NormalizationConfig;
    chunking: ChunkingConfig;
    metadata: MetadataConfig;
    validation: ValidationConfig;
    logTransformations: boolean;
    cachePatterns: boolean;
}
export declare const defaultScrubberConfig: ScrubberConfig;
