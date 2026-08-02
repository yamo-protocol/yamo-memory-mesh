/**
 * Synthesized-skills subsystem — extracted from the MemoryMesh god-class
 * (workspace-cg2). Skill ingest (with AGP Phase 3b staging), LLM synthesis,
 * reliability outcome updates, pruning, listing, and hybrid skill search.
 * Functions take the mesh facade as their first argument; MemoryMesh
 * delegates 1:1.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createLogger } from "../../utils/logger.js";
import { rrfMerge } from "./rrf.js";
import { extractSkillIdentity, extractSkillTags } from "../../utils/skill-metadata.js";
import type { MemoryMesh, PendingSkillIngest } from "../memory-mesh.js";

const logger = createLogger("brain");

/**
 * Ingest synthesized skill
 * @param sourceFilePath - If provided, skip file write (file already exists)
 */
export async function ingestSkill(mesh: MemoryMesh, yamoText: string, metadata: Record<string, any> = {}, sourceFilePath?: string, opts: { stage?: boolean } = {}) {
    await mesh.init();
    if (!mesh.skillTable) {
        throw new Error("Skill table not initialized");
    }
    // DEBUG: Trace sourceFilePath parameter
    if (process.env.YAMO_DEBUG_PATHS === "true") {
        console.error(`[BRAIN.ingestSkill] sourceFilePath parameter: ${sourceFilePath || "undefined"}`);
    }
    try {
        const identity = extractSkillIdentity(yamoText);
        const name = metadata.name || identity.name;
        const intent = metadata.intent || identity.intent;
        const description = metadata.description || identity.description;
        // RECURSION DETECTION: Check for recursive naming patterns
        // Patterns like "SkillSkill", "SkillSkillSkill" indicate filename-derived names
        const recursivePattern = /^(Skill|skill){2,}/;
        if (recursivePattern.test(name)) {
            logger.warn({ originalName: name }, "Detected recursive naming pattern, rejecting ingestion to prevent loop");
            throw new Error(`Recursive naming pattern detected: ${name}. Skills must have proper name: field.`);
        }
        // Extract tags for tag-aware embeddings (improves semantic search)
        const tags = extractSkillTags(yamoText);
        const tagText = tags.length > 0 ? `\nTags: ${tags.join(", ")}` : "";
        const embeddingText = `Skill: ${name}\nIntent: ${intent}${tagText}\nDescription: ${description}`;
        const vector = await mesh.embeddingFactory.embed(embeddingText);
        const id = `skill_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;
        const skillMetadata = {
            reliability: 0.5,
            use_count: 0,
            source: "manual",
            ...metadata,
            // Store source file path for policy loading and parent discovery
            ...(sourceFilePath && { source_file: sourceFilePath }),
        };
        const record = {
            id,
            name,
            intent,
            yamo_text: yamoText,
            vector,
            metadata: JSON.stringify(skillMetadata),
            created_at: new Date(),
        };
        // Phase 3b staging: defer the LanceDB write so an uncommitted (κ-pending)
        // skill is never indexed and therefore can't be intercepted before approval.
        // Return the fully-built row for the caller to flush via commitPendingIngest().
        if (opts.stage) {
            return { id, name, intent, pendingIngest: { record } };
        }
        await mesh.skillTable.add([record]);
        // NEW: Persist to filesystem for longevity and visibility
        // Skip if sourceFilePath provided (file already exists from SkillCreator)
        // Skip if using in-memory database (:memory:)
        if (!sourceFilePath && mesh.dbDir !== ":memory:") {
            try {
                const skillsDir = path.resolve(process.cwd(), mesh.skillDirectories[0] || "skills");
                if (!fs.existsSync(skillsDir)) {
                    fs.mkdirSync(skillsDir, { recursive: true });
                }
                // Robust filename with length limit to prevent ENAMETOOLONG
                const safeName = name
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, "-")
                    .replace(/-+/g, "-")
                    .substring(0, 50);
                const fileName = `skill-${safeName}.md`;
                const filePath = path.join(skillsDir, fileName);
                // Only write if file doesn't already exist to prevent duplicates
                if (!fs.existsSync(filePath)) {
                    fs.writeFileSync(filePath, yamoText, "utf8");
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.debug({ filePath }, "Skill persisted to file");
                    }
                }
            }
            catch (fileError) {
                logger.warn({ err: fileError }, "Failed to persist skill to file");
            }
        }
        return { id, name, intent };
    }
    catch (error) {
        throw new Error(`Skill ingestion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Flush a {@link PendingSkillIngest} produced by `synthesize({ ingest: "stage" })`
 * into the `synthesized_skills` table (AGP Phase 3b κ-commit). Pass `finalSourceFile`
 * when the staged skill file has been moved to its live location so the indexed
 * row's `source_file` points at the committed path rather than the staging path.
 */

export async function commitPendingIngest(mesh: MemoryMesh, pending: PendingSkillIngest, opts: { finalSourceFile?: string } = {}) {
    await mesh.init();
    if (!mesh.skillTable) {
        throw new Error("Skill table not initialized");
    }
    const record = { ...pending.record };
    if (opts.finalSourceFile) {
        let meta: Record<string, any> = {};
        try {
            meta = typeof record.metadata === "string" ? JSON.parse(record.metadata) : { ...record.metadata };
        }
        catch {
            meta = {};
        }
        meta.source_file = opts.finalSourceFile;
        record.metadata = JSON.stringify(meta);
    }
    await mesh.skillTable.add([record]);
    return { id: record.id, name: record.name, intent: record.intent };
}
/**
 * Serialize the skillDirectories[0] hot-swap window for staged synthesis so two
 * concurrent staged synthesize() calls can't read each other's redirected path.
 * Returns a release function the caller MUST invoke in a `finally`.
 */

export async function _acquireStagingLock(mesh: MemoryMesh): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
        release = resolve;
    });
    const prev = mesh._stagingLock;
    mesh._stagingLock = prev.then(() => next);
    await prev;
    return release;
}
/**
 * Recursive Skill Synthesis
 */

export async function synthesize(mesh: MemoryMesh, options: { topic?: string; enrichedPrompt?: string; mode?: string; targetSkillId?: string; lookback?: number; stagingSkillDir?: string; ingest?: "commit" | "stage" } = {}) {
    await mesh.init();
    const topic = options.topic || "general_improvement";
    const enrichedPrompt = options.enrichedPrompt || topic; // PHASE 4: Use enriched prompt
    const mode = options.mode || "create";
    const targetSkillId = options.targetSkillId;

    // const lookback = options.lookback || 20;
    logger.info({ topic, mode, targetSkillId }, "Synthesizing logic");

    // OPTIMIZATION: If we have an execution engine (kernel), use SkillCreator!
    if (mesh._kernel_execute) {
        logger.info("Dispatching to SkillCreator agent...");
        // AGP Phase 3b — staged synthesis. When stagingSkillDir is set, redirect the
        // SkillCreator's writes to the staging dir and defer the LanceDB ingest so an
        // uncommitted skill is neither on the live skill path nor index-discoverable
        // until the kernel's κ operator approves it.
        const stagingSkillDir = options.stagingSkillDir;
        const ingestMode = options.ingest ?? "commit";
        let releaseLock: (() => void) | undefined;
        let originalSkillDir0: string | undefined;
        try {
            if (stagingSkillDir) {
                releaseLock = await mesh._acquireStagingLock();
                if (!fs.existsSync(stagingSkillDir)) {
                    fs.mkdirSync(stagingSkillDir, { recursive: true });
                }
                originalSkillDir0 = mesh.skillDirectories[0];
                mesh.skillDirectories[0] = stagingSkillDir;
            }
            // Fetch target skill content if refactoring
            let targetContent = "";
            let targetPath = "";
            if (mode === "refactor" && targetSkillId) {
                const skill = await mesh.getSkill(targetSkillId);
                if (skill) {
                    targetPath = skill.metadata?.source_file || "";
                    if (targetPath && fs.existsSync(targetPath)) {
                        targetContent = fs.readFileSync(targetPath, "utf8");
                    } else {
                        // Fallback to DB content if file missing
                        targetContent = skill.yamo_text || "";
                    }
                }
            }

            // Use stored skill directories
            const skillDirs = mesh.skillDirectories;
            // Track existing skill files (.md and legacy .yamo) before SkillCreator runs
            const filesBefore = new Set();
            for (const dir of skillDirs) {
                if (fs.existsSync(dir)) {
                    const walk = (currentDir: string) => {
                        try {
                            const entries = fs.readdirSync(currentDir, {
                                withFileTypes: true,
                            });
                            for (const entry of entries) {
                                const fullPath = path.join(currentDir, entry.name);
                                if (entry.isDirectory()) {
                                    walk(fullPath);
                                }
                                else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yamo"))) {
                                    filesBefore.add(fullPath);
                                }
                            }
                        }
                        catch (e) {
                            // Skip directories we can't read
                            logger.debug({ dir, error: e }, "Could not read directory");
                        }
                    };
                    walk(dir);
                }
            }

            // PHASE 4: Use enriched prompt for SkillCreator
            let prompt = `SkillCreator: design a new skill to handle ${enrichedPrompt}`;
            if (mode === "refactor" && targetContent) {
                prompt = `SkillCreator: REFACTOR and FIX the following skill. It failed with the following context: ${enrichedPrompt}.\n\nEXISTING SKILL CONTENT:\n${targetContent}`;
            }

            await mesh._kernel_execute(prompt, {
                v1_1_enabled: true,
            });
            // Find newly created skill file (.md or legacy .yamo)
            let newSkillFile;
            for (const dir of skillDirs) {
                if (fs.existsSync(dir)) {
                    const walk = (currentDir: string) => {
                        try {
                            const entries = fs.readdirSync(currentDir, {
                                withFileTypes: true,
                            });
                            for (const entry of entries) {
                                const fullPath = path.join(currentDir, entry.name);
                                if (entry.isDirectory()) {
                                    walk(fullPath);
                                }
                                else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yamo"))) {
                                    if (!filesBefore.has(fullPath)) {
                                        newSkillFile = fullPath;
                                    }
                                }
                            }
                        }
                        catch (e) {
                            logger.debug({ dir, error: e }, "Could not read directory");
                        }
                    };
                    walk(dir);
                }
            }
            // Ingest the newly created skill file
            if (newSkillFile) {
                logger.info({ skillFile: newSkillFile }, "Ingesting newly synthesized skill");
                let skillContent = fs.readFileSync(newSkillFile, "utf8");
                // PHASE 4: Expand compressed → canonical for disk storage
                // Skills created by evolution are typically compressed; expand to canonical for readability
                // Skip expansion in test environment or when disabled
                const expansionEnabled = process.env.YAMO_EXPANSION_ENABLED !== "false";
                const isCompressed = !skillContent.includes("---") ||
                    (skillContent.includes("---") &&
                        skillContent.split("---").length <= 1);
                if (expansionEnabled && isCompressed) {
                    logger.info({ skillFile: newSkillFile }, "Expanding compressed skill to canonical format");
                    try {
                        const expanded = await mesh._kernel_execute("skill-expansion-system-prompt.md", {
                            input_yamo: skillContent,
                        });
                        if (expanded && expanded.canonical_yamo) {
                            skillContent = expanded.canonical_yamo;
                            // Write expanded canonical format back to disk
                            fs.writeFileSync(newSkillFile, skillContent, "utf8");
                            logger.info({ skillFile: newSkillFile }, "Skill expanded to canonical format on disk");
                        }
                    }
                    catch (e) {
                        logger.warn({ err: e }, "Failed to expand skill to canonical, using compressed format");
                    }
                }
                // ENSURE: Synthesized skills always have proper metadata with meaningful name
                // This prevents duplicate skill-agent-{timestamp}.md files
                const synIdentity = extractSkillIdentity(skillContent);
                const hasName = !synIdentity.name.startsWith("Unnamed_");
                if (!skillContent.includes("---") || !hasName) {
                    logger.info({ skillFile: newSkillFile }, "Adding metadata block to synthesized skill");
                    const intent = synIdentity.intent !== "general_procedure"
                        ? synIdentity.intent.replace(/[^a-zA-Z0-9]/g, "")
                        : "Synthesized";
                    const PascalCase = intent.charAt(0).toUpperCase() + intent.slice(1);
                    const skillName = `${PascalCase}_${Date.now().toString(36)}`;
                    const metadata = `---
name: ${skillName}
version: 1.0.0
author: YAMO Evolution
license: MIT
tags: synthesized, evolution, auto-generated
description: Auto-generated skill to handle: ${enrichedPrompt || topic}
---
`;
                    // Prepend metadata if skill doesn't have it
                    if (!skillContent.startsWith("---")) {
                        skillContent = metadata + skillContent;
                        // Write back to disk with proper metadata
                        fs.writeFileSync(newSkillFile, skillContent, "utf8");
                        logger.info({ skillFile: newSkillFile, skillName }, "Added metadata block to synthesized skill");
                    }
                }
                if (ingestMode === "stage") {
                    const staged = await mesh.ingestSkill(skillContent, {
                        source: "synthesized",
                        trigger_topic: topic,
                    }, newSkillFile, { stage: true });
                    return {
                        status: "success",
                        analysis: "SkillCreator orchestrated evolution (staged, pending κ commit)",
                        skill_id: staged.id,
                        skill_name: staged.name,
                        yamo_text: skillContent,
                        stagingPath: newSkillFile,
                        pendingIngest: staged.pendingIngest,
                    };
                }
                const skill = await mesh.ingestSkill(skillContent, {
                    source: "synthesized",
                    trigger_topic: topic,
                }, newSkillFile);
                return {
                    status: "success",
                    analysis: "SkillCreator orchestrated evolution",
                    skill_id: skill.id,
                    skill_name: skill.name,
                    yamo_text: skillContent,
                };
            }
            // Fallback if no new file found
            return {
                status: "success",
                analysis: "SkillCreator orchestrated evolution (no file detected)",
                skill_name: topic.split(" ")[0],
            };
        }
        catch (e) {
            logger.error({ err: e }, "SkillCreator agent failed");
            return {
                status: "error",
                error: e instanceof Error ? e.message : String(e),
                analysis: "SkillCreator agent failed",
            };
        }
        finally {
            // Restore the live skill path and release the lock even on error/return.
            if (originalSkillDir0 !== undefined) {
                mesh.skillDirectories[0] = originalSkillDir0;
            }
            if (releaseLock) {
                releaseLock();
            }
        }
    }
    // SkillCreator is required for synthesis
    if (!mesh._kernel_execute) {
        throw new Error("Kernel execution (_kernel_execute) is required for synthesis. Use YamoKernel instead of MemoryMesh directly.");
    }
    // Should never reach here
    return {
        status: "error",
        analysis: "Unexpected state in synthesis",
    };
}
/**
 * Update reliability
 */

export async function updateSkillReliability(mesh: MemoryMesh, id: string, success: boolean) {
    await mesh.init();
    if (!mesh.skillTable) {
        throw new Error("Skill table not initialized");
    }
    try {
        const results = await mesh.skillTable
            .query()
            .filter(`id == '${id}'`)
            .toArray();
        if (results.length === 0) {
            throw new Error(`Skill ${id} not found`);
        }
        const record = results[0];
        const metadata = JSON.parse(record.metadata);
        const previousReliability = metadata.reliability ?? null;
        const adjustment = success ? 0.1 : -0.2;
        metadata.reliability = Math.max(0, Math.min(1.0, (metadata.reliability || 0.5) + adjustment));
        metadata.use_count = (metadata.use_count || 0) + 1;
        metadata.last_used = new Date().toISOString();
        await mesh.skillTable.update({
            where: `id == '${id}'`,
            values: { metadata: JSON.stringify(metadata) },
        });
        // Revision log shares the memory_revisions table — skill ids are
        // just another id namespace (workspace-g9p.3).
        mesh._recordRevision(id, [{ field: "reliability", oldValue: previousReliability, newValue: metadata.reliability }]);
        return {
            id,
            reliability: metadata.reliability,
            use_count: metadata.use_count,
        };
    }
    catch (error) {
        throw new Error(`Failed to update skill reliability: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Get a single synthesized skill by ID
 * @param {string} id - Skill ID
 * @returns {Promise<Object|null>} Skill data or null if not found
 */

export async function getSkill(mesh: MemoryMesh, id: string) {
    await mesh.init();
    if (!mesh.skillTable) {
        return null;
    }
    try {
        const results = await mesh.skillTable
            .query()
            .filter(`id == '${id}'`)
            .toArray();
        if (results.length === 0) {
            return null;
        }
        const record = results[0];
        return {
            ...record,
            metadata: typeof record.metadata === "string"
                ? JSON.parse(record.metadata)
                : record.metadata,
        };
    }
    catch (error) {
        logger.warn({ err: error, id }, "Failed to get skill");
        return null;
    }
}
/**
 * Prune skills
 */

export async function pruneSkills(mesh: MemoryMesh, threshold = 0.3) {
    await mesh.init();
    if (!mesh.skillTable) {
        throw new Error("Skill table not initialized");
    }
    try {
        const allSkills = await mesh.skillTable.query().toArray();
        let prunedCount = 0;
        for (const skill of allSkills) {
            const metadata = JSON.parse(skill.metadata);
            if (metadata.reliability < threshold) {
                await mesh.skillTable.delete(`id == '${skill.id}'`);
                prunedCount++;
            }
        }
        return {
            pruned_count: prunedCount,
            total_remaining: allSkills.length - prunedCount,
        };
    }
    catch (error) {
        throw new Error(`Pruning failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * List all synthesized skills
 * @param {Object} [options={}] - Search options
 * @returns {Promise<Array>} Normalized skill results
 */

export async function listSkills(mesh: MemoryMesh, options: { limit?: number } = {}) {
    await mesh.init();
    if (!mesh.skillTable) {
        return [];
    }
    try {
        const limit = options.limit || 10;
        const results = await mesh.skillTable.query().limit(limit).toArray();
        return results.map((r: any) => ({
            ...r,
            score: 1.0, // Full score for direct listing
            // Parse metadata JSON string to object
            metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
        }));
    }
    catch (error) {
        if (process.env.YAMO_DEBUG === "true") {
            logger.error({ err: error }, "Skill list failed");
        }
        return [];
    }
}
/**
 * Search for synthesized skills by semantic intent
 * @param {string} query - Search query (intent description)
 * @param {Object} [options={}] - Search options
 * @returns {Promise<Array>} Normalized skill results
 */

export async function searchSkills(mesh: MemoryMesh, query: string, options: { limit?: number } = {}) {
    await mesh.init();
    if (!mesh.skillTable) {
        return [];
    }
    try {
        // 1. Check for explicit skill targeting (e.g., "Architect: ...")
        const explicitMatch = query.match(/^([a-zA-Z0-9_-]+):/);
        if (explicitMatch) {
            const targetName = explicitMatch[1];
            const directResults = await mesh.skillTable
                .query()
                .where(`name == '${targetName}'`)
                .limit(1)
                .toArray();
            if (directResults.length > 0) {
                return directResults.map((r: any) => ({
                    ...r,
                    score: 1.0, // Maximum score for explicit target
                }));
            }
        }
        // 2. Hybrid search: vector + keyword matching
        const limit = options.limit || 5;
        const queryTokens = mesh._tokenizeQuery(query);

        // 2a. Vector search (get more candidates for fusion)
        const vector = await mesh.embeddingFactory.embed(query, { isQuery: true });
        const vectorResults = await mesh.skillTable
            .search(vector)
            .limit(limit * 3)
            .toArray();

        // 2b. Parallel Keyword search at database level using LIKE expression
        let keywordResults = [];
        if (queryTokens.length > 0) {
            const escapedTokens = queryTokens.map(t => t.replace(/'/g, "''"));
            const filterExpr = escapedTokens
                .map(t => `(name LIKE '%${t}%' OR intent LIKE '%${t}%' OR yamo_text LIKE '%${t}%')`)
                .join(" OR ");
            try {
                keywordResults = await mesh.skillTable
                    .query()
                    .where(filterExpr)
                    .limit(limit * 3)
                    .toArray();
            } catch (err) {
                if (process.env.YAMO_DEBUG === "true") {
                    logger.warn({ err }, "Keyword search query in searchSkills failed");
                }
            }
        }

        // 2c. Merge and deduplicate candidates
        const allCandidates = [...vectorResults, ...keywordResults];
        const uniqueCandidates = [];
        const seenIds = new Set();
        for (const c of allCandidates) {
            if (!seenIds.has(c.id)) {
                seenIds.add(c.id);
                uniqueCandidates.push(c);
            }
        }

        // 2d. Compute keyword match score for all candidates
        const keywordScores = new Map();
        let maxKeywordScore = 0;
        for (const result of uniqueCandidates) {
            let score = 0;
            const nameTokens = mesh._tokenizeQuery(result.name);
            const intentTokens = mesh._tokenizeQuery(result.intent || "");
            const tags = extractSkillTags(result.yamo_text);
            const tagTokens = tags.flatMap((t) => mesh._tokenizeQuery(t));
            const descTokens = mesh._tokenizeQuery(result.yamo_text.substring(0, 500)); // First 500 chars

            // Token matching with field-based weights
            // Support both exact and partial matches (for compound words)
            for (const qToken of queryTokens) {
                // Exact or partial match in name
                if (nameTokens.some((nt) => nt === qToken || qToken.includes(nt) || nt.includes(qToken))) {
                    score += 10.0; // Highest: name match
                }
                // Exact or partial match in tags
                if (tagTokens.some((tt) => tt === qToken || qToken.includes(tt) || tt.includes(qToken))) {
                    score += 7.0; // High: tag match
                }
                // Exact match in intent
                if (intentTokens.some((it) => it === qToken)) {
                    score += 5.0; // Medium: intent match
                }
                // Exact match in description
                if (descTokens.some((dt) => dt === qToken)) {
                    score += 1.0; // Low: description match
                }
            }
            if (score > 0) {
                keywordScores.set(result.id, score);
                maxKeywordScore = Math.max(maxKeywordScore, score);
            }
        }

        // Sort unique candidates by computed keyword score for RRF ranking
        const keywordRanked = [...uniqueCandidates]
            .filter(c => keywordScores.has(c.id))
            .sort((a, b) => (keywordScores.get(b.id) || 0) - (keywordScores.get(a.id) || 0));

        // 2e. Apply Reciprocal Rank Fusion (RRF) — shared implementation (mesh/rrf.ts)
        const fused = rrfMerge([
            { items: vectorResults as Array<{ id: string }>, weight: 0.4 },
            { items: keywordRanked, weight: 0.6 },
        ]);

        // 2f. Build fused results with combined score compatibility
        const fusedResults = fused
            .map(({ id, doc }) => {
                const r: any = doc;
                // Find vector similarity: 1 - distance / 2
                const vecMatch = vectorResults.find((v: any) => v.id === id);
                const rawDistance = vecMatch && vecMatch._distance !== undefined ? vecMatch._distance : 1.0;
                const vectorScore = Math.max(0, Math.min(1.0, 1 - rawDistance / 2));

                const keywordScore = keywordScores.get(id) || 0;
                const normalizedKeyword = maxKeywordScore > 0 ? keywordScore / maxKeywordScore : 0;
                const combinedScore = 0.7 * normalizedKeyword + 0.3 * vectorScore;

                return {
                    ...r,
                    score: combinedScore,
                    _vectorScore: vectorScore,
                    _keywordScore: keywordScore,
                };
            });
        // Sort by combined score and return top results
        // Don't normalize - we already calculated hybrid scores
        return fusedResults
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((r) => ({
            ...r,
            // Parse metadata JSON string to object for policy loading
            metadata: typeof r.metadata === "string"
                ? JSON.parse(r.metadata)
                : r.metadata,
        }))
            .map((r) => ({
            ...r,
            score: parseFloat(r.score.toFixed(2)), // Round for consistency
        }));
    }
    catch (error) {
        if (process.env.YAMO_DEBUG === "true") {
            logger.error({ err: error }, "Skill search failed");
        }
        return [];
    }
}
