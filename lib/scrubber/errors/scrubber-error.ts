/**
 * S-MORA Layer 0 Scrubber Error Classes
 * @module smora/scrubber/errors/scrubber-error
 */

export class ScrubberError extends Error {
  details;
  timestamp;
  constructor(message: string, details: Record<string, any> = {}) {
    super(message);
    this.name = 'ScrubberError';
    this.details = details;
    this.timestamp = new Date().toISOString();
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

export class StructuralCleaningError extends ScrubberError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
    this.name = 'StructuralCleaningError';
  }
}

export class ChunkingError extends ScrubberError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
    this.name = 'ChunkingError';
  }
}

export class ValidationError extends ScrubberError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
    this.name = 'ValidationError';
  }
}