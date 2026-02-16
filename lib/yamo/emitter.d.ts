/**
 * YAMO Emitter - Constructs structured YAMO blocks for auditability
 *
 * Based on YAMO Protocol specification:
 * - Semicolon-terminated key-value pairs
 * - Agent/Intent/Context/Constraints/Meta/Output structure
 * - Supports reflect, retain, recall operations
 *
 * Reference: Hindsight project's yamo_integration.py
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
