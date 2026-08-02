/**
 * YAMO audit-trail subsystem — extracted from the MemoryMesh god-class
 * (workspace-cg2). Functions take the mesh facade as their first argument and
 * operate on its state; MemoryMesh delegates to them 1:1, so behavior and the
 * public API are unchanged.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as lancedb from "@lancedb/lancedb";
import { createLogger } from "../../utils/logger.js";
const logger = createLogger("brain");
/**
 * Get recent YAMO logs for the heartbeat
 * @param {Object} options
 */
export async function getYamoLog(mesh, options = {}) {
    if (!mesh.yamoTable) {
        return [];
    }
    const limit = options.limit || 10;
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // LanceDB >= 0.30 has a typed orderBy — newest-first at the
            // database, no overscan fallback needed.
            // Non-null: guarded on entry; the retry path below may refresh
            // the handle between attempts.
            const results = await mesh.yamoTable
                .query()
                .orderBy({ columnName: "timestamp", ascending: false })
                .limit(limit)
                .toArray();
            // Defensive re-sort over ≤limit rows (mixed Date/number timestamps)
            return results
                .sort((a, b) => {
                const tA = a.timestamp instanceof Date
                    ? a.timestamp.getTime()
                    : Number(a.timestamp);
                const tB = b.timestamp instanceof Date
                    ? b.timestamp.getTime()
                    : Number(b.timestamp);
                return tB - tA;
            })
                .slice(0, limit)
                .map((r) => ({
                id: r.id,
                yamoText: r.yamo_text,
                timestamp: r.timestamp,
            }));
        }
        catch (error) {
            const msg = (error instanceof Error ? error.message : String(error)) || "";
            const isRetryable = msg.includes("LanceError(IO)") ||
                msg.includes("next batch") ||
                msg.includes("No such file") ||
                msg.includes("busy");
            if (isRetryable && attempt < maxRetries) {
                // If we suspect stale table handle, try to refresh it
                try {
                    // Re-open table to get fresh file handles
                    const { createYamoTable } = await import("../../yamo/schema.js");
                    if (mesh.dbDir) {
                        const db = await lancedb.connect(mesh.dbDir);
                        mesh.yamoTable = await createYamoTable(db, "yamo_blocks");
                        if (process.env.YAMO_DEBUG === "true") {
                            logger.debug({ attempt, msg: msg.substring(0, 100) }, "Refreshed yamoTable handle during retry");
                        }
                    }
                }
                catch (e) {
                    logger.warn({ err: e }, "Failed to refresh table handle during retry");
                }
                const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms, 2000ms, 4000ms
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            // Only act on final failure
            if (attempt === maxRetries) {
                if (isRetryable && mesh.dbDir) {
                    // All retries exhausted with IO error. The YAMO audit trail is
                    // append-only and Merkle-anchored, so we MUST NOT drop it. Quarantine
                    // the corrupt table (preserve on disk, move aside) and disable the log
                    // for this session; an operator must inspect it and clear the corruption
                    // marker before a fresh table is created (see init()).
                    logger.error({ err: error, table: "yamo_blocks", dbDir: mesh.dbDir }, "yamo_blocks IO corruption persisted after retries — quarantining table and disabling audit log; operator intervention required");
                    try {
                        await mesh._quarantineYamoTable(error);
                    }
                    catch (quarantineErr) {
                        logger.error({ err: quarantineErr }, "Failed to quarantine corrupt yamo_blocks table (data left in place)");
                    }
                    mesh.yamoTable = null;
                }
                else {
                    logger.warn({ err: error }, "Failed to get log after retries");
                }
            }
            else if (!isRetryable) {
                // Non-retryable error
                logger.warn({ err: error }, "Failed to get log (non-retryable)");
                break;
            }
        }
    }
    return [];
}
/**
 * Quarantine a corrupt yamo_blocks table without destroying it.
 * Writes a CORRUPT marker (so init() refuses to silently recreate) and moves
 * the table directory aside with a timestamp suffix, preserving anchored audit
 * blocks for forensic recovery. No-op for in-memory stores.
 * @private
 */
export async function _quarantineYamoTable(mesh, cause) {
    if (!mesh.dbDir || mesh.dbDir === ":memory:")
        return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const marker = path.join(mesh.dbDir, "yamo_blocks.CORRUPT");
    fs.writeFileSync(marker, JSON.stringify({
        quarantinedAt: ts,
        reason: String((cause && cause.message) || cause || "unknown"),
    }, null, 2));
    const tableDir = path.join(mesh.dbDir, "yamo_blocks.lance");
    if (fs.existsSync(tableDir)) {
        const asideDir = path.join(mesh.dbDir, `yamo_blocks.corrupt-${ts}`);
        fs.renameSync(tableDir, asideDir);
        logger.warn({ from: tableDir, to: asideDir }, "Moved corrupt yamo_blocks table aside (preserved for recovery)");
    }
}
/**
 * Emit a YAMO block to the YAMO blocks table
 * @private
 *
 * Note: YAMO emission is non-critical - failures are logged but don't throw
 * to prevent disrupting the main operation.
 */
export async function _emitYamoBlock(mesh, operationType, memoryId, yamoText, heritage) {
    if (!mesh.yamoTable) {
        return;
    }
    const yamoId = `yamo_${operationType}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    try {
        await mesh.yamoTable.add([
            {
                id: yamoId,
                agent_id: mesh.agentId,
                operation_type: operationType,
                yamo_text: yamoText,
                timestamp: new Date(),
                block_hash: null,
                prev_hash: null,
                metadata: JSON.stringify({
                    memory_id: memoryId || null,
                    timestamp: new Date().toISOString(),
                    ...(heritage ? { heritage_chain: heritage } : {}),
                }),
            },
        ]);
    }
    catch (error) {
        // Log emission failures in debug mode
        // Emission is non-critical, so we don't throw
        if (process.env.YAMO_DEBUG === "true") {
            logger.warn({ err: error, operationType }, "YAMO emission failed");
        }
    }
}
export async function anchor(mesh) {
    await mesh.init();
    if (!mesh.yamoTable) {
        throw new Error("YAMO blocks table not initialized");
    }
    const allBlocks = await mesh.yamoTable.query().toArray();
    allBlocks.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const unanchored = allBlocks.filter((b) => !b.anchored_at);
    if (unanchored.length === 0) {
        return null;
    }
    const anchored = allBlocks.filter((b) => b.anchored_at);
    const crypto = await import("crypto");
    const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
    let prevHash = anchored.length > 0 ? anchored[anchored.length - 1].block_hash : sha256("GENESIS");
    const leafHashes = [];
    const updates = [];
    for (let i = 0; i < unanchored.length; i++) {
        const block = unanchored[i];
        const blockHash = sha256(block.yamo_text + prevHash);
        leafHashes.push(blockHash);
        updates.push({
            id: block.id,
            block_hash: blockHash,
            prev_hash: prevHash,
            anchored_at: new Date(),
        });
        prevHash = blockHash;
    }
    // Build Merkle Tree
    const buildMerkleTree = (leaves) => {
        if (leaves.length === 0)
            return { root: sha256(""), tree: [[]] };
        const tree = [leaves];
        while (tree[tree.length - 1].length > 1) {
            const currentLevel = tree[tree.length - 1];
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
                nextLevel.push(sha256(left + right));
            }
            tree.push(nextLevel);
        }
        return { root: tree[tree.length - 1][0], tree };
    };
    const { root } = buildMerkleTree(leafHashes);
    // Update database records
    for (const update of updates) {
        await mesh.yamoTable.update({
            where: `id == '${update.id}'`,
            values: {
                block_hash: update.block_hash,
                prev_hash: update.prev_hash,
                anchored_at: update.anchored_at,
            },
        });
    }
    return {
        root,
        count: unanchored.length,
        updates,
    };
}
