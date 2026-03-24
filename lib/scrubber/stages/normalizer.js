// @ts-nocheck
/**
 * S-MORA Layer 0 Scrubber - Stage 3: Normalization
 * @module smora/scrubber/stages/normalizer
 */
export class Normalizer {
    constructor(config) {
        this.config = config;
    }
    /**
     * Normalize content structure
     * @param {string} content - Filtered content
     * @returns {Promise<string>} - Normalized content
     */
    async normalize(content) {
        let normalized = content;
        if (this.config.normalizeHeadings) {
            normalized = this._normalizeHeadings(normalized);
        }
        if (this.config.normalizeLists) {
            normalized = this._normalizeLists(normalized);
        }
        if (this.config.normalizePunctuation) {
            normalized = this._normalizePunctuation(normalized);
        }
        return normalized;
    }
    _normalizeHeadings(content) {
        let normalized = content.replace(/(#{1,6})([^\s#])/g, '$1 $2');
        normalized = normalized.replace(/^\s*(#{1,6})/gm, '$1');
        normalized = normalized.replace(/#{7,}/g, '######');
        return normalized;
    }
    _normalizeLists(content) {
        // Anchor to line start, and require a genuine single-character list marker —
        // negative lookahead (?![*+\-]) prevents **bold** or -- from being split.
        let normalized = content.replace(/^([ \t]*)([-*+])(?![*+\-])([^ \t\n])/gm, '$1$2 $3');
        // Only matches "digit dot non-space" at line start — safe for version numbers.
        normalized = normalized.replace(/^([ \t]*)(\d+)\.([^ \t\n])/gm, '$1$2. $3');
        return normalized;
    }
    _normalizePunctuation(content) {
        // Remove quotes (both straight and curly)
        let normalized = content.replace(/["'""''`]/g, '');
        normalized = normalized.replace(/ +/g, ' ');
        normalized = normalized.replace(/\.{4,}/g, '...');
        return normalized;
    }
}
