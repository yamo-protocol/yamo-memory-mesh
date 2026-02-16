/**
 * S-MORA Layer 0 Scrubber Error Classes
 * @module smora/scrubber/errors/scrubber-error
 */
export declare class ScrubberError extends Error {
    constructor(message: any, details?: {});
    toJSON(): {
        name: string;
        message: string;
        details: any;
        timestamp: any;
    };
}
export declare class StructuralCleaningError extends ScrubberError {
    constructor(message: any, details?: {});
}
export declare class ChunkingError extends ScrubberError {
    constructor(message: any, details?: {});
}
export declare class ValidationError extends ScrubberError {
    constructor(message: any, details?: {});
}
