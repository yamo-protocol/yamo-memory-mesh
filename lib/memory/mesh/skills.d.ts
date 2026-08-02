import type { MemoryMesh, PendingSkillIngest } from "../memory-mesh.js";
/**
 * Ingest synthesized skill
 * @param sourceFilePath - If provided, skip file write (file already exists)
 */
export declare function ingestSkill(mesh: MemoryMesh, yamoText: string, metadata?: Record<string, any>, sourceFilePath?: string, opts?: {
    stage?: boolean;
}): Promise<{
    id: string;
    name: any;
    intent: any;
    pendingIngest: {
        record: {
            id: string;
            name: any;
            intent: any;
            yamo_text: string;
            vector: any;
            metadata: string;
            created_at: Date;
        };
    };
} | {
    id: string;
    name: any;
    intent: any;
    pendingIngest?: undefined;
}>;
/**
 * Flush a {@link PendingSkillIngest} produced by `synthesize({ ingest: "stage" })`
 * into the `synthesized_skills` table (AGP Phase 3b κ-commit). Pass `finalSourceFile`
 * when the staged skill file has been moved to its live location so the indexed
 * row's `source_file` points at the committed path rather than the staging path.
 */
export declare function commitPendingIngest(mesh: MemoryMesh, pending: PendingSkillIngest, opts?: {
    finalSourceFile?: string;
}): Promise<{
    id: any;
    name: any;
    intent: any;
}>;
/**
 * Serialize the skillDirectories[0] hot-swap window for staged synthesis so two
 * concurrent staged synthesize() calls can't read each other's redirected path.
 * Returns a release function the caller MUST invoke in a `finally`.
 */
export declare function _acquireStagingLock(mesh: MemoryMesh): Promise<() => void>;
/**
 * Recursive Skill Synthesis
 */
export declare function synthesize(mesh: MemoryMesh, options?: {
    topic?: string;
    enrichedPrompt?: string;
    mode?: string;
    targetSkillId?: string;
    lookback?: number;
    stagingSkillDir?: string;
    ingest?: "commit" | "stage";
}): Promise<{
    status: string;
    analysis: string;
    skill_id: string;
    skill_name: any;
    yamo_text: string;
    stagingPath: never;
    pendingIngest: {
        record: {
            id: string;
            name: any;
            intent: any;
            yamo_text: string;
            vector: any;
            metadata: string;
            created_at: Date;
        };
    } | undefined;
    error?: undefined;
} | {
    status: string;
    analysis: string;
    skill_id: string;
    skill_name: any;
    yamo_text: string;
    stagingPath?: undefined;
    pendingIngest?: undefined;
    error?: undefined;
} | {
    status: string;
    analysis: string;
    skill_name: string;
    skill_id?: undefined;
    yamo_text?: undefined;
    stagingPath?: undefined;
    pendingIngest?: undefined;
    error?: undefined;
} | {
    status: string;
    error: string;
    analysis: string;
    skill_id?: undefined;
    skill_name?: undefined;
    yamo_text?: undefined;
    stagingPath?: undefined;
    pendingIngest?: undefined;
} | {
    status: string;
    analysis: string;
    skill_id?: undefined;
    skill_name?: undefined;
    yamo_text?: undefined;
    stagingPath?: undefined;
    pendingIngest?: undefined;
    error?: undefined;
}>;
/**
 * Update reliability
 */
export declare function updateSkillReliability(mesh: MemoryMesh, id: string, success: boolean): Promise<{
    id: string;
    reliability: any;
    use_count: any;
}>;
/**
 * Get a single synthesized skill by ID
 * @param {string} id - Skill ID
 * @returns {Promise<Object|null>} Skill data or null if not found
 */
export declare function getSkill(mesh: MemoryMesh, id: string): Promise<any>;
/**
 * Prune skills
 */
export declare function pruneSkills(mesh: MemoryMesh, threshold?: number): Promise<{
    pruned_count: number;
    total_remaining: number;
}>;
/**
 * List all synthesized skills
 * @param {Object} [options={}] - Search options
 * @returns {Promise<Array>} Normalized skill results
 */
export declare function listSkills(mesh: MemoryMesh, options?: {
    limit?: number;
}): Promise<any>;
/**
 * Search for synthesized skills by semantic intent
 * @param {string} query - Search query (intent description)
 * @param {Object} [options={}] - Search options
 * @returns {Promise<Array>} Normalized skill results
 */
export declare function searchSkills(mesh: MemoryMesh, query: string, options?: {
    limit?: number;
}): Promise<any>;
