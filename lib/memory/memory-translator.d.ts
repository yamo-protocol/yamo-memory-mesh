/**
 * MemoryTranslator - Converts memories to YAMO agent format
 */
export interface TranslationOptions {
    mode?: string;
    includeMetadata?: boolean;
    maxContentLength?: number;
}
export declare class MemoryTranslator {
    #private;
    /**
     * Translate memories into YAMO agent context
     * @param {Array<any>} memories - Retrieved memories
     * @param {TranslationOptions} options - Translation options
     * @returns {string} Formatted YAMO agent context
     */
    static toYAMOContext(memories: any[], options?: TranslationOptions): string;
}
export default MemoryTranslator;
