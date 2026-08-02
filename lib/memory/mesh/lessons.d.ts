import type { MemoryMesh } from "../memory-mesh.js";
/**
 * Distill a LessonLearned block (RFC-0011 §3.5).
 * Idempotent: same patternId + equal/higher confidence returns existing.
 */
export declare function distillLesson(mesh: MemoryMesh, context: {
    situation: string;
    errorPattern: string;
    oversight: string;
    fix: string;
    preventativeRule: string;
    severity?: string;
    applicableScope: string;
    inverseLesson?: string;
    confidence?: number;
}): Promise<{
    lessonId: string;
    patternId: string;
    severity: string;
    preventativeRule: string;
    ruleConfidence: number;
    applicableScope: string;
    wireFormat: string;
    memoryId: string;
}>;
/**
 * Query lessons from memory (RFC-0011 §4.1).
 */
export declare function queryLessons(mesh: MemoryMesh, query?: string, options?: {
    limit?: number;
}): Promise<any[]>;
/**
 * Return all memories whose lesson_pattern_id matches patternId (RFC-0011 §4.1).
 */
export declare function getMemoriesByPattern(mesh: MemoryMesh, patternId: string): Promise<any[]>;
