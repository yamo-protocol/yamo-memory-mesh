/**
 * S-MORA Layer 0 Scrubber Telemetry Collection
 * @module smora/scrubber/telemetry
 */
export interface StageStats {
    count: number;
    totalTime: number;
    errors: number;
}
export interface StageSummary {
    count: number;
    avgTime: number;
    totalTime: number;
    errors: number;
}
export interface TelemetrySummary {
    stages: Record<string, StageStats>;
    performance: {
        structural: number;
        semantic: number;
        normalization: number;
        chunking: number;
        metadata: number;
        validation: number;
        total: number;
    };
}
export declare class ScrubberTelemetry {
    stats: Record<string, StageStats>;
    constructor();
    recordStage(stage: string, duration: number, success?: boolean): void;
    getStageStats(stage: string): StageSummary;
    getSummary(): TelemetrySummary;
    reset(): void;
    assertPerformanceBudget(budget?: number): void;
}
