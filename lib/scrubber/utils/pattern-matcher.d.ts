/**
 * Boilerplate Pattern Matching Utilities
 * @module smora/scrubber/utils/pattern-matcher
 */
export declare class PatternMatcher {
    boilerplatePatterns: (string | RegExp)[];
    constructor();
    _loadDefaultPatterns(): (string | RegExp)[];
    getBoilerplatePatterns(): (string | RegExp)[];
    addPattern(pattern: RegExp): void;
    removePattern(index: number): void;
    isBoilerplate(text: string): boolean;
}
