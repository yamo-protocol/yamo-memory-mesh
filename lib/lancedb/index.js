export { LanceDBClient } from './client.js';
export { loadConfig, validateConfig, getConfig, DEFAULTS } from './config.js';
export { MEMORY_SCHEMA, INDEX_CONFIG, createMemoryTable, createMemoryTableWithDimension, createMemorySchema, getEmbeddingDimension, DEFAULT_VECTOR_DIMENSION, EMBEDDING_DIMENSIONS } from './schema.js';
export { LanceDBError, EmbeddingError, StorageError, QueryError, ConfigurationError, handleError, sanitizeErrorMessage } from './errors.js';
