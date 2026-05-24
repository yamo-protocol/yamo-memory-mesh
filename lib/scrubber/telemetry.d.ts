/**
 * S-MORA Layer 0 Scrubber Telemetry Collection
 * @module smora/scrubber/telemetry
 */
export declare class ScrubberTelemetry {
    stats: Record<string, {
        count: number;
        totalTime: number;
        errors: number;
    }>;
    constructor();
    recordStage(stage: string, duration: number, success?: boolean): void;
    getStageStats(stage: string): {
        count: number;
        avgTime: number;
        totalTime: number;
        errors: number;
    };
    getSummary(): {
        stages: Record<string, {
            count: number;
            totalTime: number;
            errors: number;
        }>;
        performance: {
            structural: number;
            semantic: number;
            normalization: number;
            chunking: number;
            metadata: number;
            validation: number;
            total: any;
        };
    };
    reset(): void;
    assertPerformanceBudget(budget?: number): void;
}
