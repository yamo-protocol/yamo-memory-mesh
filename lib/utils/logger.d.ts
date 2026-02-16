/**
 * Structured Logger using Pino
 * Provides centralized logging with metadata support, PII redaction, and environment-based formatting
 */
import pino from "pino";
/**
 * Main logger instance with configuration
 */
export declare const logger: pino.Logger<never, boolean>;
/**
 * Create a child logger with module-specific context
 * @param module - Module name for logging context
 * @returns Child logger instance
 *
 * @example
 * const logger = createLogger('kernel');
 * logger.info({ action: 'boot' }, 'Kernel starting');
 */
export declare function createLogger(module: any): pino.Logger<never, boolean>;
