// @ts-nocheck
/**
 * Boilerplate Pattern Matching Utilities
 * @module smora/scrubber/utils/pattern-matcher
 */
export class PatternMatcher {
    constructor() {
        this.boilerplatePatterns = this._loadDefaultPatterns();
    }
    _loadDefaultPatterns() {
        return [
            // Legal/Footer
            /©\s*\d{4}/i,
            /all rights reserved/i,
            /copyright\s+\d{4}/i,
            // Navigation
            /^home\s*\|/i,
            /^navigation\s*:|menu\s*:/i,
            /sidebar/i,
            // Meta
            /^last\s+updated?\s*:/i,
            /cookie\s+policy/i,
            /privacy\s+policy/i,
            // Auto-generated
            /^table\s+of\s+contents?$/i,
            /^contents\s*$/i,
            /jump\s+to\s+(section|navigation)/i,
            // Strings
            'home | docs | contact',
            'skip to main content',
            'this site uses cookies'
        ];
    }
    getBoilerplatePatterns() {
        return this.boilerplatePatterns;
    }
    addPattern(pattern) {
        this.boilerplatePatterns.push(pattern);
    }
    removePattern(index) {
        if (index >= 0 && index < this.boilerplatePatterns.length) {
            this.boilerplatePatterns.splice(index, 1);
        }
    }
    isBoilerplate(text) {
        const lowerText = text.toLowerCase().trim();
        return this.boilerplatePatterns.some(pattern => {
            if (pattern instanceof RegExp) {
                return pattern.test(lowerText);
            }
            return lowerText.includes(pattern);
        });
    }
}
