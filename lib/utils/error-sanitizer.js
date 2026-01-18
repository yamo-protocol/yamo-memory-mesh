/**
 * Secure Error Handling Utilities
 * Sanitizes error messages to prevent API key leakage
 */

/**
 * Sanitize error messages by redacting sensitive information
 * @param {string} message - Error message to sanitize
 * @returns {string} Sanitized error message
 */
export function sanitizeErrorMessage(message) {
  if (typeof message !== 'string') {
    return '[Non-string error message]';
  }

  // Redact common sensitive patterns
  return message
    // Redact Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    // Redact OpenAI API keys (sk- followed by 32+ chars)
    .replace(/sk-[A-Za-z0-9]{32,}/g, 'sk-[REDACTED]')
    // Redact generic API keys (20+ alphanumeric chars after api_key)
    .replace(/api_key["\s:]+[A-Za-z0-9]{20,}/gi, 'api_key: [REDACTED]')
    // Redact environment variable patterns that might contain secrets
    .replace(/(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY)[="'\s]+[A-Za-z0-9\-_]+/gi, '$1=[REDACTED]')
    // Redact Authorization headers
    .replace(/Authorization:\s*[^"\r\n]+/gi, 'Authorization: [REDACTED]')
    // Redact potential JWT tokens (header.payload.signature pattern)
    .replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[JWT_REDACTED]');
}

/**
 * Sanitize error object for logging
 * @param {Error|Object} error - Error object to sanitize
 * @returns {Object} Sanitized error object safe for logging
 */
export function sanitizeErrorForLogging(error) {
  if (!error || typeof error !== 'object') {
    return { message: '[Invalid error object]' };
  }

  const sanitized = {
    name: error.name || 'Error',
    message: sanitizeErrorMessage(error.message || 'Unknown error')
  };

  // Only include stack in development
  if (process.env.NODE_ENV === 'development' && error.stack) {
    sanitized.stack = error.stack;
  }

  // Include code if present (non-sensitive)
  if (error.code) {
    sanitized.code = error.code;
  }

  // Include timestamp
  sanitized.timestamp = new Date().toISOString();

  return sanitized;
}

/**
 * Wrap a function to catch and sanitize errors
 * @param {Function} fn - Function to wrap
 * @param {string} context - Context description for error logging
 * @returns {Function} Wrapped function with error sanitization
 */
export function withSanitizedErrors(fn, context = 'operation') {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const sanitizedError = sanitizeErrorForLogging(error);
      throw {
        success: false,
        error: {
          ...sanitizedError,
          context
        }
      };
    }
  };
}
