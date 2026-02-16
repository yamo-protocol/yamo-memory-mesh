/**
 * YAMO Module - YAMO Protocol support for yamo-memory-mesh
 * Exports YAMO block construction, validation, and schema utilities
 */
export { YamoEmitter } from './emitter.js';
export * from './schema.js';
declare const _default: {
    YamoEmitter: typeof import("./emitter.js").YamoEmitter;
    createYamoSchema: typeof import("./schema.js").createYamoSchema;
    createYamoTable: typeof import("./schema.js").createYamoTable;
    validateYamoRecord: typeof import("./schema.js").validateYamoRecord;
    generateYamoId: typeof import("./schema.js").generateYamoId;
};
export default _default;
