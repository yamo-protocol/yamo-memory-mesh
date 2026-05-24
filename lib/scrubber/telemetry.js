/**
 * S-MORA Layer 0 Scrubber Telemetry Collection
 * @module smora/scrubber/telemetry
 */
export class ScrubberTelemetry {
    stats;
    constructor() {
        this.stats = {
            structural: { count: 0, totalTime: 0, errors: 0 },
            semantic: { count: 0, totalTime: 0, errors: 0 },
            normalization: { count: 0, totalTime: 0, errors: 0 },
            chunking: { count: 0, totalTime: 0, errors: 0 },
            metadata: { count: 0, totalTime: 0, errors: 0 },
            validation: { count: 0, totalTime: 0, errors: 0 },
        };
    }
    recordStage(stage, duration, success = true) {
        if (!this.stats[stage]) {
            this.stats[stage] = { count: 0, totalTime: 0, errors: 0 };
        }
        this.stats[stage].count++;
        this.stats[stage].totalTime += duration;
        if (!success) {
            this.stats[stage].errors++;
        }
    }
    getStageStats(stage) {
        const stats = this.stats[stage] || { count: 0, totalTime: 0, errors: 0 };
        return {
            count: stats.count,
            avgTime: stats.count > 0 ? stats.totalTime / stats.count : 0,
            totalTime: stats.totalTime,
            errors: stats.errors,
        };
    }
    getSummary() {
        return {
            stages: this.stats,
            performance: {
                structural: this.stats.structural.totalTime,
                semantic: this.stats.semantic.totalTime,
                normalization: this.stats.normalization.totalTime,
                chunking: this.stats.chunking.totalTime,
                metadata: this.stats.metadata.totalTime,
                validation: this.stats.validation.totalTime,
                total: Object.values(this.stats).reduce((sum, s) => sum + s.totalTime, 0),
            },
        };
    }
    reset() {
        Object.keys(this.stats).forEach((key) => {
            this.stats[key] = { count: 0, totalTime: 0, errors: 0 };
        });
    }
    assertPerformanceBudget(budget = 10) {
        const summary = this.getSummary();
        if (summary.performance.total > budget) {
            throw new Error(`Performance budget exceeded: ${summary.performance.total}ms > ${budget}ms`);
        }
    }
}
