/**
 * YAMO Emitter - Constructs structured YAMO ABNF blocks for auditability
 *
 * Based on YAMO Protocol RFC-0011 §3.2 (ABNF colon-separated multi-line format).
 * This format is DISTINCT from the flat wire format (RFC-0008 / RFC-0014).
 *
 * Escaping: RFC-0014 — semicolons in values are percent-encoded as `%3B`.
 * (Supersedes the comma-escape scheme used prior to 2026-03-14.)
 *
 * Reference: yamo-os lib/yamo/emitter.ts (canonical implementation)
 */
/**
 * YamoEmitter class for building YAMO protocol blocks
 * YAMO (Yet Another Multi-agent Orchestration) blocks provide
 * structured reasoning traces for AI agent operations.
 */
export declare class YamoEmitter {
    /**
     * Build a YAMO block for reflect operation
     * Reflect operations synthesize insights from existing memories
     */
    static buildReflectBlock(params: any): string;
    /**
     * Build a YAMO block for retain (add) operation
     * Retain operations store new memories into the system
     */
    static buildRetainBlock(params: any): string;
    /**
     * Build a YAMO block for recall (search) operation
     * Recall operations retrieve memories based on semantic similarity
     */
    static buildRecallBlock(params: any): string;
    /**
     * Build a YAMO block for delete operation (optional)
     * Delete operations remove memories from the system
     */
    static buildDeleteBlock(params: any): string;
    /**
     * Validate a YAMO block structure
     * Checks for required sections and proper formatting
     */
    static validateBlock(yamoBlock: any): {
        valid: boolean;
        errors: any[];
    };
}
export default YamoEmitter;
