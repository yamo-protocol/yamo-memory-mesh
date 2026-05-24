/**
 * S-MORA Layer 0 Scrubber Error Classes
 * @module smora/scrubber/errors/scrubber-error
 */
export declare class ScrubberError extends Error {
    details: Record<string, any>;
    timestamp: string;
    constructor(message: string, details?: Record<string, any>);
    toJSON(): {
        name: string;
        message: string;
        details: Record<string, any>;
        timestamp: string;
    };
}
export declare class StructuralCleaningError extends ScrubberError {
    constructor(message: string, details?: Record<string, any>);
}
export declare class ChunkingError extends ScrubberError {
    constructor(message: string, details?: Record<string, any>);
}
export declare class ValidationError extends ScrubberError {
    constructor(message: string, details?: Record<string, any>);
}
