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
export interface ReflectBlockParams {
    topic?: string;
    memoryCount: number;
    agentId?: string;
    reflection: string;
    confidence?: number;
}
export interface RetainBlockParams {
    content: string;
    metadata?: any;
    id: string;
    agentId?: string;
    memoryType?: string;
}
export interface RecallBlockParams {
    query: string;
    resultCount: number;
    limit?: number;
    agentId?: string;
    searchType?: string;
}
export interface DeleteBlockParams {
    id: string;
    agentId?: string;
    reason?: string;
}
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
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
    static buildReflectBlock(params: ReflectBlockParams): string;
    /**
     * Build a YAMO block for retain (add) operation
     * Retain operations store new memories into the system
     */
    static buildRetainBlock(params: RetainBlockParams): string;
    /**
     * Build a YAMO block for recall (search) operation
     * Recall operations retrieve memories based on semantic similarity
     */
    static buildRecallBlock(params: RecallBlockParams): string;
    /**
     * Build a YAMO block for delete operation (optional)
     * Delete operations remove memories from the system
     */
    static buildDeleteBlock(params: DeleteBlockParams): string;
    /**
     * Validate a YAMO block structure
     * Checks for required sections and proper formatting
     */
    static validateBlock(yamoBlock: string): ValidationResult;
}
export default YamoEmitter;
