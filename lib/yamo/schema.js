// @ts-nocheck
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
export function createYamoSchema() {
    return new arrow.Schema([
        // Core identifiers
        new arrow.Field("id", new arrow.Utf8(), false),
        new arrow.Field("agent_id", new arrow.Utf8(), true),
        // Operation tracking
        new arrow.Field("operation_type", new arrow.Utf8(), false), // 'retain', 'recall', 'reflect'
        new arrow.Field("yamo_text", new arrow.Utf8(), false), // Full YAMO block content
        // Temporal
        new arrow.Field("timestamp", new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), false),
        // Blockchain fields (optional, nullable) - for future anchoring
        new arrow.Field("block_hash", new arrow.Utf8(), true), // Hash of this block
        new arrow.Field("prev_hash", new arrow.Utf8(), true), // Hash of previous block (for chain)
        // Metadata (JSON string for flexibility)
        new arrow.Field("metadata", new arrow.Utf8(), true), // Additional metadata as JSON
    ]);
}
/**
 * Create YAMO blocks table in LanceDB
 * Creates the table if it doesn't exist, opens it if it does
 *
 * @param {lancedb.Connection} db - LanceDB connection
 * @param {string} [tableName='yamo_blocks'] - Name of the table
 * @returns {Promise<lancedb.Table>} The created or opened table
 * @throws {Error} If table creation fails
 */
export async function createYamoTable(db, tableName = "yamo_blocks") {
    try {
        const existingTables = await db.tableNames();
        let table;
        if (existingTables.includes(tableName)) {
            table = await db.openTable(tableName);
        }
        else {
            const schema = createYamoSchema();
            table = await db.createTable(tableName, [], {
                schema,
                storageOptions: { new_table_data_storage_version: "stable" },
            });
        }
        // Migrate manifest paths to V2 layout (idempotent)
        try {
            await table.migrateManifestPathsV2();
        }
        catch {
            // Already migrated or not a local table — ignore
        }
        return table;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create YAMO table '${tableName}': ${message}`);
    }
}
/**
 * Validate a YAMO block record before insertion
 * Checks for required fields and valid values
 */
export function validateYamoRecord(record) {
    const errors = [];
    // Check required fields
    if (!record.id) {
        errors.push("Missing required field: id");
    }
    if (!record.operation_type) {
        errors.push("Missing required field: operation_type");
    }
    else {
        // Validate operation_type is one of the allowed values
        const validTypes = ["retain", "recall", "reflect"];
        if (!validTypes.includes(record.operation_type)) {
            errors.push(`Invalid operation_type: ${record.operation_type}. Must be one of: ${validTypes.join(", ")}`);
        }
    }
    if (!record.yamo_text) {
        errors.push("Missing required field: yamo_text");
    }
    else {
        // Validate YAMO block format
        const requiredSections = [
            "agent:",
            "intent:",
            "context:",
            "output:",
            "log:",
        ];
        for (const section of requiredSections) {
            if (!record.yamo_text.includes(section)) {
                errors.push(`YAMO block missing required section: ${section}`);
            }
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
/**
 * Generate a YAMO block ID
 * Creates a unique ID for a YAMO block
 *
 * @param {string} operationType - Type of operation
 * @returns {string} Generated YAMO block ID
 */
export function generateYamoId(operationType) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `yamo_${operationType}_${timestamp}_${random}`;
}
/**
 * Check if a table uses YAMO schema
 * Detects if a table has the YAMO block schema structure
 *
 * @param {arrow.Schema} schema - Table schema to check
 * @returns {boolean} True if YAMO schema detected
 */
export function isYamoSchema(schema) {
    // Check for unique YAMO fields
    const hasYamoFields = schema.fields.some((f) => f.name === "operation_type" || f.name === "yamo_text");
    return hasYamoFields;
}
// Export schema function as default for consistency with lancedb/schema.js
export default {
    createYamoSchema,
    createYamoTable,
    validateYamoRecord,
    generateYamoId,
    isYamoSchema,
};
