/**
 * Boilerplate Pattern Matching Utilities
 * @module smora/scrubber/utils/pattern-matcher
 */
export declare class PatternMatcher {
    constructor();
    _loadDefaultPatterns(): (string | RegExp)[];
    getBoilerplatePatterns(): any;
    addPattern(pattern: any): void;
    removePattern(index: any): void;
    isBoilerplate(text: any): any;
}
