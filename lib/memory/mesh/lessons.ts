/**
 * RFC-0011 lessons subsystem — extracted from the MemoryMesh god-class
 * (workspace-cg2). Distills structured lessons into idempotent pattern-keyed
 * memories and queries them back. Functions take the mesh facade as their
 * first argument; MemoryMesh delegates 1:1.
 */
import crypto from "crypto";
import { createLogger } from "../../utils/logger.js";
import { METADATA_SCAN_CAP } from "./shared.js";
import type { MemoryMesh } from "../memory-mesh.js";

const logger = createLogger("brain");

/**
 * Distill a LessonLearned block (RFC-0011 §3.5).
 * Idempotent: same patternId + equal/higher confidence returns existing.
 */
export async function distillLesson(mesh: MemoryMesh, context: {
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
}> {
    await mesh.init();
    const {
        situation, errorPattern, oversight, fix, preventativeRule,
        severity = "medium", applicableScope, inverseLesson = "", confidence = 0.7,
    } = context;
    const patternId = crypto.createHash("sha256")
        .update(errorPattern + applicableScope).digest("hex").slice(0, 16);
    // Idempotency check
    const existing = await mesh.getMemoriesByPattern(patternId);
    if (existing.length > 0) {
        const meta = typeof existing[0].metadata === "string"
            ? JSON.parse(existing[0].metadata) : existing[0].metadata;
        if ((meta.rule_confidence ?? 0) >= confidence) {
            return {
                lessonId: meta.lesson_id, patternId, severity: meta.severity || severity,
                preventativeRule: meta.preventative_rule || preventativeRule,
                ruleConfidence: meta.rule_confidence, applicableScope: meta.applicable_scope || applicableScope,
                wireFormat: meta.yamo_wire_format || "", memoryId: existing[0].id,
            };
        }
    }
    const lessonId = `lesson_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const timestamp = new Date().toISOString();
    const wireFormat = [
        `agent: MemoryMesh_${mesh.agentId};`,
        `intent: distill_wisdom_from_execution;`,
        `context:`,
        `  original_context;${situation.replace(/;/g, "%3B")};`,
        `  error_pattern;${patternId};`,
        `  severity;${severity};`,
        `  timestamp;${timestamp};`,
        `constraints:`,
        `  hypothesis;This lesson prevents recurrence of similar failures;`,
        `  hypothesis_confidence;${confidence};`,
        `priority: high;`,
        `output:`,
        `  lesson_id;${lessonId};`,
        `  oversight_description;${oversight.replace(/;/g, "%3B")};`,
        `  preventative_rule;${preventativeRule.replace(/;/g, "%3B")};`,
        `  rule_confidence;${confidence};`,
        `meta:`,
        `  rationale;${fix.replace(/;/g, "%3B")};`,
        `  applicability_scope;${applicableScope.replace(/;/g, "%3B")};`,
        `  inverse_lesson;${inverseLesson.replace(/;/g, "%3B")};`,
        `  confidence;${confidence};`,
        `log: lesson_learned;timestamp;${timestamp};pattern;${patternId};severity;${severity};id;${lessonId};`,
        `handoff: SubconsciousReflector;`,
    ].join("\n");
    const lessonContent = `[LESSON:${patternId}] ${oversight} | Rule: ${preventativeRule} | Scope: ${applicableScope}`;
    const lessonMetadata = {
        type: "lesson", tags: ["#lesson_learned"], lesson_id: lessonId,
        lesson_pattern_id: patternId, severity, oversight, preventative_rule: preventativeRule,
        rule_confidence: confidence, applicable_scope: applicableScope, inverse_lesson: inverseLesson,
        yamo_wire_format: wireFormat, source: "distillLesson",
    };
    const mem = await mesh.add(lessonContent, lessonMetadata);
    if (mesh.enableYamo) {
        mesh._emitYamoBlock("lesson", mem.id, wireFormat).catch(() => {});
    }
    return { lessonId, patternId, severity, preventativeRule, ruleConfidence: confidence, applicableScope, wireFormat, memoryId: mem.id };
}
/**
 * Query lessons from memory (RFC-0011 §4.1).
 */

export async function queryLessons(mesh: MemoryMesh, query = "", options: { limit?: number } = {}): Promise<any[]> {
    await mesh.init();
    const limit = options.limit || 10;
    if (!mesh.client) return [];
    const filter = `memory_type == 'lesson' OR metadata LIKE '%"type":"lesson"%' OR metadata LIKE '%#lesson_learned%'`;
    const matching = await mesh.client.getWhere(filter, { limit: METADATA_SCAN_CAP });
    if (matching.length >= METADATA_SCAN_CAP) {
        logger.warn({ cap: METADATA_SCAN_CAP }, "queryLessons hit METADATA_SCAN_CAP — results may be truncated");
    }
    const lessons = matching.filter((r: any) => {
        try {
            const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
            return meta.type === "lesson" || (Array.isArray(meta.tags) && meta.tags.includes("#lesson_learned"));
        } catch { return false; }
    });
    let scored = lessons as any[];
    if (query) {
        const q = query.toLowerCase();
        scored = lessons.map((r: any) => ({
            ...r,
            _score: (r.content?.toLowerCase().includes(q) ? 2 : 0) +
                (JSON.stringify(r.metadata).toLowerCase().includes(q) ? 1 : 0),
        })).sort((a: any, b: any) => b._score - a._score);
    }
    return scored.slice(0, limit).map((r: any) => {
        const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
        return {
            lessonId: meta.lesson_id || r.id, patternId: meta.lesson_pattern_id || "",
            severity: meta.severity || "medium", preventativeRule: meta.preventative_rule || "",
            ruleConfidence: meta.rule_confidence ?? 0, applicableScope: meta.applicable_scope || "",
            wireFormat: meta.yamo_wire_format || "", memoryId: r.id,
        };
    });
}

/**
 * Return all memories whose lesson_pattern_id matches patternId (RFC-0011 §4.1).
 */
export async function getMemoriesByPattern(mesh: MemoryMesh, patternId: string): Promise<any[]> {
    await mesh.init();
    if (!mesh.client) return [];
    // Build a needle matching the stored JSON form, then escape it for SQL LIKE.
    // JSON.stringify mirrors how the value is serialized in metadata (handles "/\).
    // Escape order: backslash first, then the LIKE wildcards %/_ (the key itself
    // contains underscores), then the SQL single-quote. ESCAPE '\' is confirmed
    // supported by LanceDB. The JS post-filter below remains authoritative for exact match.
    const needle = `"lesson_pattern_id":${JSON.stringify(patternId)}`;
    const likeEscaped = needle
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")
        .replace(/'/g, "''");
    const filter = `metadata LIKE '%${likeEscaped}%' ESCAPE '\\'`;
    const matching = await mesh.client.getWhere(filter, { limit: METADATA_SCAN_CAP });
    if (matching.length >= METADATA_SCAN_CAP) {
        logger.warn({ cap: METADATA_SCAN_CAP, patternId }, "getMemoriesByPattern hit METADATA_SCAN_CAP — results may be truncated");
    }
    return (matching as any[]).filter((r) => {
        try {
            const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
            return meta.lesson_pattern_id === patternId;
        } catch { return false; }
    });
}

