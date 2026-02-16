/**
 * S-MORA Layer 0 Scrubber Telemetry Collection
 * @module smora/scrubber/telemetry
 */
export declare class ScrubberTelemetry {
    stats: any;
    constructor();
    recordStage(stage: any, duration: any, success?: boolean): void;
    getStageStats(stage: any): {
        count: any;
        avgTime: number;
        totalTime: any;
        errors: any;
    };
    getSummary(): {
        stages: any;
        performance: {
            structural: any;
            semantic: any;
            normalization: any;
            chunking: any;
            metadata: any;
            validation: any;
            total: unknown;
        };
    };
    reset(): void;
    assertPerformanceBudget(budget?: number): void;
}
