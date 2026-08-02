/**
 * Maintenance & portability subsystem — extracted from the MemoryMesh
 * god-class (workspace-cg2). Deterministic vector-free JSONL export/import,
 * the stale-memories report, and the doctor health checks. Functions take the
 * mesh facade as their first argument; MemoryMesh delegates 1:1.
 */
import fs from "fs";
import path from "path";
import { toEpochMs } from "./shared.js";
import { INDEX_CONFIG } from "../schema.js";
import { extractSkillTags } from "../../utils/skill-metadata.js";
import type { MemoryMesh } from "../memory-mesh.js";


/**
 * Passive human-readable JSONL export (workspace-g9p.2) — the issues.jsonl
 * principle. Vectors are derived data (re-embeddable from content), so the
 * export carries content + metadata only: git-committable, PR-diffable,
 * and sufficient for a full rebuild via importJsonl().
 *
 * Determinism contract: rows are sorted by (table, id), field order is
 * fixed, and no volatile values (export timestamps, floats re-derived at
 * export time) are included — consecutive exports of an unchanged DB are
 * byte-identical.
 */
export async function exportJsonl(mesh: MemoryMesh, filePath?: string): Promise<{ path: string | null; lines: number; text?: string }> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const toIso = (v: unknown) => {
        if (v === null || v === undefined) return null;
        const ms = toEpochMs(v);
        return isNaN(ms) ? null : new Date(ms).toISOString();
    };
    const lines: string[] = [JSON.stringify({ _export: { format: 1 } })];
    const pushSorted = (rows: string[][]) => {
        // rows: [id, serialized] — sort by id for deterministic output
        rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        for (const [, line] of rows) lines.push(line);
    };
    // memory_entries — raw rows so metadata stays the stored JSON string.
    const memRows: string[][] = [];
    const rawMemories = await mesh.client.table.query().toArray();
    for (const r of rawMemories) {
        memRows.push([r.id, JSON.stringify({
            table: "memory_entries",
            id: r.id,
            content: r.content,
            metadata: r.metadata ?? null,
            created_at: toIso(r.created_at),
            updated_at: toIso(r.updated_at),
            superseded_at: toIso(r.superseded_at),
            session_id: r.session_id ?? null,
            agent_id: r.agent_id ?? null,
            memory_type: r.memory_type ?? null,
            importance_score: r.importance_score ?? null,
            access_count: r.access_count === null || r.access_count === undefined ? null : Number(r.access_count),
            last_accessed: toIso(r.last_accessed),
            state: r.state ?? null,
            pinned: r.pinned === null || r.pinned === undefined ? null : r.pinned === true,
            defer_until: toIso(r.defer_until),
        })]);
    }
    pushSorted(memRows);
    // synthesized_skills
    if (mesh.skillTable) {
        const skillRows: string[][] = [];
        for (const r of await mesh.skillTable.query().toArray()) {
            skillRows.push([r.id, JSON.stringify({
                table: "synthesized_skills",
                id: r.id,
                name: r.name,
                intent: r.intent,
                yamo_text: r.yamo_text,
                metadata: r.metadata ?? null,
                created_at: toIso(r.created_at),
            })]);
        }
        pushSorted(skillRows);
    }
    // decision_edges
    if (mesh.decisionEdgeTable) {
        const edgeRows: string[][] = [];
        for (const r of await mesh.decisionEdgeTable.query().toArray()) {
            edgeRows.push([r.id, JSON.stringify({
                table: "decision_edges",
                id: r.id,
                source_id: r.source_id,
                target_id: r.target_id,
                relation: r.relation,
                rationale: r.rationale ?? null,
                weight: r.weight ?? null,
                created_at: toIso(r.created_at),
            })]);
        }
        pushSorted(edgeRows);
    }
    // graph_edges
    if (mesh.graphTable) {
        const graphRows: string[][] = [];
        for (const r of await mesh.graphTable.query().toArray()) {
            graphRows.push([r.id, JSON.stringify({
                table: "graph_edges",
                id: r.id,
                source: r.source,
                target: r.target,
                relation: r.relation,
                weight: r.weight ?? null,
                created_at: toIso(r.created_at),
            })]);
        }
        pushSorted(graphRows);
    }
    // memory_revisions
    if (mesh.revisionTable) {
        const revRows: string[][] = [];
        for (const r of await mesh.revisionTable.query().toArray()) {
            revRows.push([r.id, JSON.stringify({
                table: "memory_revisions",
                id: r.id,
                memory_id: r.memory_id,
                field: r.field,
                old_value: r.old_value ?? null,
                new_value: r.new_value ?? null,
                actor: r.actor ?? null,
                created_at: toIso(r.created_at),
            })]);
        }
        pushSorted(revRows);
    }
    const text = lines.join("\n") + "\n";
    if (filePath) {
        fs.writeFileSync(filePath, text, "utf8");
        return { path: path.resolve(filePath), lines: lines.length };
    }
    return { path: null, lines: lines.length, text };
}
/**
 * Import a JSONL export (workspace-g9p.2), re-embedding content locally.
 * Idempotent: rows whose id already exists in the target table are
 * skipped, so import-into-nonempty is safe.
 */

export async function importJsonl(mesh: MemoryMesh, source: string | { text: string }): Promise<Record<string, { imported: number; skipped: number }>> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const text = typeof source === "string" ? fs.readFileSync(source, "utf8") : source.text;
    const rows = text
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
    if (!rows.length || !rows[0]._export || rows[0]._export.format !== 1) {
        throw new Error("importJsonl: not a memory-mesh export (missing format-1 header)");
    }
    const fromIso = (v: unknown) => (typeof v === "string" ? new Date(v) : null);
    const existingIds = async (table: any): Promise<Set<string>> => {
        if (!table) return new Set();
        try {
            const idRows = await table.query().select(["id"]).toArray();
            return new Set(idRows.map((r: any) => r.id as string));
        }
        catch {
            const idRows = await table.query().toArray();
            return new Set(idRows.map((r: any) => r.id as string));
        }
    };
    const counts: Record<string, { imported: number; skipped: number }> = {};
    const bump = (table: string, imported: boolean) => {
        counts[table] = counts[table] ?? { imported: 0, skipped: 0 };
        counts[table][imported ? "imported" : "skipped"]++;
    };
    const memIds = await existingIds(mesh.client.table);
    const skillIds = await existingIds(mesh.skillTable);
    const dedgeIds = await existingIds(mesh.decisionEdgeTable);
    const gedgeIds = await existingIds(mesh.graphTable);
    const revIds = await existingIds(mesh.revisionTable);
    for (const row of rows.slice(1)) {
        if (row.table === "memory_entries") {
            if (memIds.has(row.id)) { bump(row.table, false); continue; }
            const vector = await mesh.embeddingFactory.embed(row.content);
            await mesh.client.table.add([{
                id: row.id,
                vector,
                content: row.content,
                metadata: row.metadata ?? null,
                created_at: fromIso(row.created_at) ?? new Date(),
                updated_at: fromIso(row.updated_at),
                superseded_at: fromIso(row.superseded_at),
                session_id: row.session_id ?? null,
                agent_id: row.agent_id ?? null,
                memory_type: row.memory_type ?? null,
                importance_score: row.importance_score ?? null,
                access_count: row.access_count ?? null,
                last_accessed: fromIso(row.last_accessed),
                state: row.state ?? null,
                pinned: row.pinned ?? null,
                defer_until: fromIso(row.defer_until),
            }]);
            if (!row.superseded_at && row.state !== "archived") {
                let meta: Record<string, unknown> = {};
                try {
                    meta = row.metadata ? JSON.parse(row.metadata) : {};
                }
                catch {
                    meta = {};
                }
                mesh.keywordSearch?.add?.(row.id, row.content, meta);
            }
            bump(row.table, true);
        }
        else if (row.table === "synthesized_skills") {
            if (!mesh.skillTable || skillIds.has(row.id)) { bump(row.table, false); continue; }
            // Reconstruct the exact ingest-time embedding text (tag-aware).
            let meta: Record<string, any> = {};
            try {
                meta = row.metadata ? JSON.parse(row.metadata) : {};
            }
            catch {
                meta = {};
            }
            const tags = extractSkillTags(row.yamo_text ?? "");
            const tagText = tags.length > 0 ? `\nTags: ${tags.join(", ")}` : "";
            const description = meta.description || "";
            const vector = await mesh.embeddingFactory.embed(`Skill: ${row.name}\nIntent: ${row.intent}${tagText}\nDescription: ${description}`);
            await mesh.skillTable.add([{
                id: row.id,
                name: row.name,
                intent: row.intent,
                yamo_text: row.yamo_text,
                vector,
                metadata: row.metadata ?? null,
                created_at: fromIso(row.created_at) ?? new Date(),
            }]);
            bump(row.table, true);
        }
        else if (row.table === "decision_edges") {
            if (!mesh.decisionEdgeTable || dedgeIds.has(row.id)) { bump(row.table, false); continue; }
            await mesh.decisionEdgeTable.add([{
                id: row.id,
                source_id: row.source_id,
                target_id: row.target_id,
                relation: row.relation,
                rationale: row.rationale ?? null,
                weight: row.weight ?? 1.0,
                created_at: fromIso(row.created_at) ?? new Date(),
            }]);
            bump(row.table, true);
        }
        else if (row.table === "graph_edges") {
            if (!mesh.graphTable || gedgeIds.has(row.id)) { bump(row.table, false); continue; }
            await mesh.graphTable.add([{
                id: row.id,
                source: row.source,
                target: row.target,
                relation: row.relation,
                weight: row.weight ?? 1.0,
                created_at: fromIso(row.created_at) ?? new Date(),
            }]);
            bump(row.table, true);
        }
        else if (row.table === "memory_revisions") {
            if (!mesh.revisionTable || revIds.has(row.id)) { bump(row.table, false); continue; }
            await mesh.revisionTable.add([{
                id: row.id,
                memory_id: row.memory_id,
                field: row.field,
                old_value: row.old_value ?? null,
                new_value: row.new_value ?? null,
                actor: row.actor ?? null,
                created_at: fromIso(row.created_at) ?? new Date(),
            }]);
            bump(row.table, true);
        }
    }
    mesh.queryCache.clear();
    return counts;
}

/**
 * Non-mutating stale-memory report (workspace-g9p.6) — the bd stale
 * analog: active rows untouched (no access, no update) for `days`.
 */
export async function staleMemoriesReport(mesh: MemoryMesh, opts: { days?: number; limit?: number } = {}): Promise<Array<{ id: string; content: string; last_touch: string | null }>> {
    await mesh.init();
    if (!mesh.client) {
        throw new Error("Database client not initialized");
    }
    const days = opts.days ?? 90;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = await mesh.client.table.query().limit(10000).toArray();
    const stale: Array<{ id: string; content: string; last_touch: string | null; _ms: number }> = [];
    for (const r of rows) {
        if (r.superseded_at || r.state === "archived") continue;
        const touch = r.last_accessed ?? r.updated_at ?? r.created_at;
        const ms = toEpochMs(touch);
        if (isNaN(ms) || ms > cutoff) continue;
        stale.push({
            id: r.id,
            content: typeof r.content === "string" ? r.content.slice(0, 120) : "",
            last_touch: isNaN(ms) ? null : new Date(ms).toISOString(),
            _ms: ms,
        });
    }
    return stale
        .sort((a, b) => a._ms - b._ms)
        .slice(0, opts.limit ?? 50)
        .map(({ _ms, ...rest }) => rest);
}
/**
 * Hygiene self-diagnosis (workspace-g9p.6) — the bd doctor analog. Runs
 * mechanical checks for every known mesh footgun; never mutates. Overall
 * ok is the AND of all non-informational checks.
 */

export async function doctor(mesh: MemoryMesh, opts: { indexThreshold?: number } = {}): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }> {
    await mesh.init();
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    // 1. Database reachable and populated
    try {
        const tables: string[] = mesh.client?.db ? await mesh.client.db.tableNames() : [];
        const rowCount = mesh.client?.table ? await mesh.client.table.countRows() : 0;
        checks.push({
            name: "database",
            ok: tables.length > 0,
            detail: `uri=${mesh.dbDir || mesh.config?.LANCEDB_URI || "?"} tables=[${tables.join(", ")}] memory_rows=${rowCount}`,
        });
    }
    catch (e) {
        checks.push({ name: "database", ok: false, detail: `unreachable: ${e instanceof Error ? e.message : String(e)}` });
    }
    // 2. Config mismatch — the live-vs-repo dir footgun: an explicit dbDir
    // that disagrees with LANCEDB_URI means tools read one store while the
    // daemon writes another.
    if (mesh.dbDir && mesh.dbDir !== ":memory:" && process.env.LANCEDB_URI) {
        const a = path.resolve(mesh.dbDir);
        const b = path.resolve(process.env.LANCEDB_URI);
        checks.push({
            name: "config-mismatch",
            ok: a === b,
            detail: a === b ? `dbDir and LANCEDB_URI agree (${a})` : `dbDir=${a} but LANCEDB_URI=${b} — reads and writes may target different stores`,
        });
    }
    // 3. Dangling decision edges
    try {
        const orphans = await mesh.orphanEdges();
        checks.push({
            name: "dangling-decision-edges",
            ok: orphans.length === 0,
            detail: orphans.length === 0
                ? "all edge endpoints resolve"
                : `${orphans.length} edge(s) with missing endpoints, e.g. ${orphans.slice(0, 3).map((o) => `${o.id}→[${o.missing.join(",")}]`).join("; ")}`,
        });
    }
    catch (e) {
        checks.push({ name: "dangling-decision-edges", ok: false, detail: String(e instanceof Error ? e.message : e) });
    }
    // 4. Vector index present once the table outgrows the partition count
    try {
        if (mesh.client?.table && typeof mesh.client.table.listIndices === "function") {
            const threshold = opts.indexThreshold ?? INDEX_CONFIG.vector.num_partitions;
            const rowCount = await mesh.client.table.countRows();
            const indices = await mesh.client.table.listIndices();
            const hasVectorIndex = indices.some((i: any) => i.columns.includes("vector"));
            checks.push({
                name: "vector-index",
                ok: rowCount < threshold || hasVectorIndex,
                detail: `rows=${rowCount} threshold=${threshold} indexed=${hasVectorIndex}`,
            });
        }
    }
    catch (e) {
        checks.push({ name: "vector-index", ok: false, detail: String(e instanceof Error ? e.message : e) });
    }
    // 5. superseded_at ↔ state drift (informational: legacy rows predate
    // the state column; backfill closes it)
    try {
        const drifted = await mesh.client!.getWhere(
            `superseded_at IS NOT NULL AND (state IS NULL OR state != 'superseded')`,
            { limit: 1000 },
        );
        checks.push({
            name: "superseded-state-drift",
            ok: true,
            detail: drifted.length === 0 ? "consistent" : `${drifted.length} legacy row(s) superseded without state='superseded' (informational)`,
        });
    }
    catch {
        // informational only
    }
    // 6. Skill metadata parseable
    try {
        if (mesh.skillTable) {
            const skills = await mesh.skillTable.query().limit(5000).toArray();
            let bad = 0;
            for (const s of skills) {
                try {
                    JSON.parse(s.metadata);
                }
                catch {
                    bad++;
                }
            }
            checks.push({ name: "skill-metadata", ok: bad === 0, detail: bad === 0 ? `${skills.length} skill(s) parse cleanly` : `${bad} skill(s) with unparseable metadata` });
        }
    }
    catch (e) {
        checks.push({ name: "skill-metadata", ok: false, detail: String(e instanceof Error ? e.message : e) });
    }
    return { ok: checks.every((c) => c.ok), checks };
}
