/**
 * MemoryTranslator - Converts memories to YAMO agent format
 */
export declare class MemoryTranslator {
    #private;
    /**
     * Translate memories into YAMO agent context
     * @param {Array<any>} memories - Retrieved memories
     * @param {TranslationOptions} options - Translation options
     * @returns {string} Formatted YAMO agent context
     */
    static toYAMOContext(memories: any, options?: {}): string;
}
export default MemoryTranslator;
