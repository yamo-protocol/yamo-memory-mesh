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
export declare function createLogger(module: string): pino.Logger;
/**
 * Log levels and their usage:
 * - fatal: Application crash, immediate attention required
 * - error: Errors that need investigation
 * - warn: Degraded state, potential issues
 * - info: Important operational events (default)
 * - debug: Detailed diagnostic information
 * - trace: Very verbose, performance metrics
 */
export type { Logger } from "pino";
