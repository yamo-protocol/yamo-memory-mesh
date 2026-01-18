/**
 * S-MORA Orchestrator Error
 *
 * Custom error class for orchestrator-specific errors
 *
 * @module smora/errors/orchestrator-error
 */

export class SMORAOrchestratorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SMORAOrchestratorError';
    this.details = details;
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

export default SMORAOrchestratorError;
