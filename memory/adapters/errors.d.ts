/**
 * Custom error classes for LanceDB operations
 *
 * Base error class for all LanceDB-related errors. Captures proper stack traces
 * to ensure debugging information points to where errors are thrown, not to the
 * error constructor.
 */
export declare class LanceDBError extends Error {
    code: string;
    details: Record<string, any>;
    timestamp: string;
    /**
     * Create a new LanceDBError
     * @param {string} message - Human-readable error message
     * @param {string} code - Machine-readable error code (e.g., 'EMBEDDING_ERROR')
     * @param {Object} details - Additional error context and metadata
     */
    constructor(message: string, code: string, details?: Record<string, any>);
}
/**
 * Error raised when embedding generation or comparison fails
 */
export declare class EmbeddingError extends LanceDBError {
    constructor(message: string, details?: Record<string, any>);
}
/**
 * Error raised when storage operations (read/write/delete) fail
 */
export declare class StorageError extends LanceDBError {
    constructor(message: string, details?: Record<string, any>);
}
/**
 * Error raised when database queries fail or return invalid results
 */
export declare class QueryError extends LanceDBError {
    constructor(message: string, details?: Record<string, any>);
}
/**
 * Error raised when configuration is missing or invalid
 */
export declare class ConfigurationError extends LanceDBError {
    constructor(message: string, details?: Record<string, any>);
}
/**
 * Sanitize error messages by redacting sensitive information
 * @param {string} message - Error message to sanitize
 * @returns {string} Sanitized error message
 */
export declare function sanitizeErrorMessage(message: unknown): string;
export interface ErrorResponse {
    success: boolean;
    error: {
        code: string;
        message: string;
        details?: Record<string, any>;
        context?: Record<string, any>;
        stack?: string;
    };
}
/**
 * Normalize errors into a consistent response format
 * @param {Error} error - The error to handle
 * @param {Object} context - Additional context about where/when the error occurred
 * @returns {Object} Formatted error response with success: false
 */
export declare function handleError(error: unknown, context?: Record<string, any>): ErrorResponse;
declare const _default: {
    LanceDBError: typeof LanceDBError;
    EmbeddingError: typeof EmbeddingError;
    StorageError: typeof StorageError;
    QueryError: typeof QueryError;
    ConfigurationError: typeof ConfigurationError;
    handleError: typeof handleError;
    sanitizeErrorMessage: typeof sanitizeErrorMessage;
};
export default _default;
