/**
 * Structured Logger using Pino
 * Provides centralized logging with metadata support, PII redaction, and environment-based formatting
 */

import pino from "pino";

// Determine if running in production
const isProduction = process.env.NODE_ENV === "production";
const logLevel = (process.env.LOG_LEVEL || "warn") as pino.Level;

/**
 * Main logger instance with configuration
 */
export const logger = pino({
  level: logLevel,

  // Pretty printing in development, JSON in production
  transport: !isProduction
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,app,version",
          singleLine: false,
        },
      }
    : undefined,

  // Base fields included in all logs
  base: {
    app: "yamo-os",
    version: process.env.npm_package_version || "1.1.0",
  },

  // Redact sensitive fields from logs
  redact: {
    paths: [
      "apiKey",
      "password",
      "token",
      "secret",
      "key",
      "*.apiKey",
      "*.password",
      "*.token",
      "*.secret",
      "*.key",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "ZAI_API_KEY",
    ],
    censor: "[REDACTED]",
  },

  // Timestamp in ISO format
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with module-specific context
 * @param module - Module name for logging context
 * @returns Child logger instance
 *
 * @example
 * const logger = createLogger('kernel');
 * logger.info({ action: 'boot' }, 'Kernel starting');
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}

/**
 * Log levels and their usage:
 * - fatal: Application crash, immediate attention required
 * - error: Errors that need investigation
 * - warn: Degraded state, potential issues
 * - info: Important operational events (default)
 * - debug: Detailed diagnostic information
 * - trace: Very verbose, performance metrics
 */

// Re-export types for convenience
export type { Logger } from "pino";
