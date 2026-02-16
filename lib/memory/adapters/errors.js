// @ts-nocheck
/**
 * Custom error classes for LanceDB operations
 *
 * Base error class for all LanceDB-related errors. Captures proper stack traces
 * to ensure debugging information points to where errors are thrown, not to the
 * error constructor.
 */
export class LanceDBError extends Error {
    code;
    details;
    timestamp;
    /**
     * Create a new LanceDBError
     * @param {string} message - Human-readable error message
     * @param {string} code - Machine-readable error code (e.g., 'EMBEDDING_ERROR')
     * @param {Object} details - Additional error context and metadata
     */
    constructor(message, code, details = {}) {
        super(message);
        this.name = "LanceDBError";
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
        // Capture stack trace for proper debugging (Node.js best practice)
        // This ensures stack traces point to where the error was thrown,
        // not to the error constructor itself
        Error.captureStackTrace(this, this.constructor);
    }
}
/**
 * Error raised when embedding generation or comparison fails
 */
export class EmbeddingError extends LanceDBError {
    constructor(message, details) {
        super(message, "EMBEDDING_ERROR", details);
        this.name = "EmbeddingError";
    }
}
/**
 * Error raised when storage operations (read/write/delete) fail
 */
export class StorageError extends LanceDBError {
    constructor(message, details) {
        super(message, "STORAGE_ERROR", details);
        this.name = "StorageError";
    }
}
/**
 * Error raised when database queries fail or return invalid results
 */
export class QueryError extends LanceDBError {
    constructor(message, details) {
        super(message, "QUERY_ERROR", details);
        this.name = "QueryError";
    }
}
/**
 * Error raised when configuration is missing or invalid
 */
export class ConfigurationError extends LanceDBError {
    constructor(message, details) {
        super(message, "CONFIGURATION_ERROR", details);
        this.name = "ConfigurationError";
    }
}
/**
 * Sanitize error messages by redacting sensitive information
 * @param {string} message - Error message to sanitize
 * @returns {string} Sanitized error message
 */
export function sanitizeErrorMessage(message) {
    if (typeof message !== "string") {
        return "[Non-string error message]";
    }
    // Redact common sensitive patterns
    return (message
        // Redact Bearer tokens
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
        // Redact OpenAI API keys (sk- followed by 32+ chars)
        .replace(/sk-[A-Za-z0-9]{32,}/g, "sk-[REDACTED]")
        // Redact generic API keys (20+ alphanumeric chars after api_key)
        .replace(/api_key["\s:]+[A-Za-z0-9]{20,}/gi, "api_key: [REDACTED]")
        // Redact environment variable patterns that might contain secrets
        .replace(/(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY)["='\s]+[A-Za-z0-9\-_]+/gi, "$1=[REDACTED]")
        // Redact Authorization headers
        .replace(/Authorization:\s*[^"\r\n]+/gi, "Authorization: [REDACTED]")
        // Redact potential JWT tokens
        .replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[JWT_REDACTED]"));
}
/**
 * Normalize errors into a consistent response format
 * @param {Error} error - The error to handle
 * @param {Object} context - Additional context about where/when the error occurred
 * @returns {Object} Formatted error response with success: false
 */
export function handleError(error, context = {}) {
    if (error instanceof LanceDBError) {
        return {
            success: false,
            error: {
                code: error.code,
                message: sanitizeErrorMessage(error.message),
                details: error.details,
                context,
            },
        };
    }
    const err = error instanceof Error ? error : new Error(String(error));
    // Wrap unknown errors
    return {
        success: false,
        error: {
            code: "UNKNOWN_ERROR",
            message: sanitizeErrorMessage(err.message),
            stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            context,
        },
    };
}
export default {
    LanceDBError,
    EmbeddingError,
    StorageError,
    QueryError,
    ConfigurationError,
    handleError,
    sanitizeErrorMessage,
};
