/**
 * YAMO Block Schema Definitions for yamo-memory-mesh
 * Uses Apache Arrow Schema format for LanceDB JavaScript SDK
 *
 * Provides schema and table creation for YAMO block persistence.
 * YAMO blocks provide audit trail for all memory operations.
 */
import * as arrow from "apache-arrow";
/**
 * Create YAMO blocks table schema
 * Defines the structure for storing YAMO protocol blocks
 * @returns {arrow.Schema} Arrow schema for YAMO blocks
 */
export declare function createYamoSchema(): arrow.Schema<any>;
/**
 * Create YAMO blocks table in LanceDB
 * Creates the table if it doesn't exist, opens it if it does
 *
 * @param {lancedb.Connection} db - LanceDB connection
 * @param {string} [tableName='yamo_blocks'] - Name of the table
 * @returns {Promise<lancedb.Table>} The created or opened table
 * @throws {Error} If table creation fails
 */
export declare function createYamoTable(db: any, tableName?: string): Promise<any>;
/**
 * Validate a YAMO block record before insertion
 * Checks for required fields and valid values
 */
export declare function validateYamoRecord(record: any): {
    valid: boolean;
    errors: any[];
};
/**
 * Generate a YAMO block ID
 * Creates a unique ID for a YAMO block
 *
 * @param {string} operationType - Type of operation
 * @returns {string} Generated YAMO block ID
 */
export declare function generateYamoId(operationType: any): string;
/**
 * Check if a table uses YAMO schema
 * Detects if a table has the YAMO block schema structure
 *
 * @param {arrow.Schema} schema - Table schema to check
 * @returns {boolean} True if YAMO schema detected
 */
export declare function isYamoSchema(schema: any): any;
declare const _default: {
    createYamoSchema: typeof createYamoSchema;
    createYamoTable: typeof createYamoTable;
    validateYamoRecord: typeof validateYamoRecord;
    generateYamoId: typeof generateYamoId;
    isYamoSchema: typeof isYamoSchema;
};
export default _default;
