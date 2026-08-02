import type { MemoryMesh } from "../memory-mesh.js";
/**
 * Get recent YAMO logs for the heartbeat
 * @param {Object} options
 */
export declare function getYamoLog(mesh: MemoryMesh, options?: {
    limit?: number;
}): Promise<any>;
/**
 * Quarantine a corrupt yamo_blocks table without destroying it.
 * Writes a CORRUPT marker (so init() refuses to silently recreate) and moves
 * the table directory aside with a timestamp suffix, preserving anchored audit
 * blocks for forensic recovery. No-op for in-memory stores.
 * @private
 */
export declare function _quarantineYamoTable(mesh: MemoryMesh, cause: any): Promise<void>;
/**
 * Emit a YAMO block to the YAMO blocks table
 * @private
 *
 * Note: YAMO emission is non-critical - failures are logged but don't throw
 * to prevent disrupting the main operation.
 */
export declare function _emitYamoBlock(mesh: MemoryMesh, operationType: string, memoryId: string | undefined, yamoText: string, heritage?: {
    intentChain: string[];
    hypotheses: string[];
    rationales: string[];
}): Promise<void>;
export declare function anchor(mesh: MemoryMesh): Promise<{
    root: string;
    count: any;
    updates: any[];
} | null>;
