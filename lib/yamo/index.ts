// @ts-nocheck
/**
 * YAMO Module - YAMO Protocol support for yamo-memory-mesh
 * Exports YAMO block construction, validation, and schema utilities
 */

export { YamoEmitter } from './emitter.js';
export * from './schema.js';

export default {
  YamoEmitter: (await import('./emitter.js')).YamoEmitter,
  createYamoSchema: (await import('./schema.js')).createYamoSchema,
  createYamoTable: (await import('./schema.js')).createYamoTable,
  validateYamoRecord: (await import('./schema.js')).validateYamoRecord,
  generateYamoId: (await import('./schema.js')).generateYamoId
};
