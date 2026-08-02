/**
 * LLM synthesis subsystem — extracted from the MemoryMesh god-class
 * (workspace-cg2). reflect() insight generation and the RAPTOR hierarchical
 * summarization tree (k-means clustering + per-cluster LLM summaries).
 * Functions take the mesh facade as their first argument; MemoryMesh
 * delegates 1:1.
 */
import crypto from "crypto";
import { createLogger } from "../../utils/logger.js";
import { YamoEmitter } from "../../yamo/emitter.js";
const logger = createLogger("brain");
/**
 * Reflect on recent memories
 */
export async function reflect(mesh, options = {}) {
    await mesh.init();
    const lookback = options.lookback || 10;
    const topic = options.topic;
    const generate = options.generate !== false;
    let memories = [];
    if (topic) {
        memories = await mesh.search(topic, { limit: lookback });
    }
    else {
        const all = await mesh.getAll();
        memories = all
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, lookback);
    }
    const prompt = `Review these memories. Synthesize a high-level "belief" or "observation".`;
    if (!generate || !mesh.enableLLM || !mesh.llmClient) {
        return {
            topic,
            count: memories.length,
            context: memories.map((m) => ({
                content: m.content,
                type: m.metadata?.type || "event",
                id: m.id,
            })),
            prompt,
        };
    }
    let reflection = "";
    let confidence = 0;
    try {
        const result = await mesh.llmClient.reflect(prompt, memories);
        reflection = result.reflection;
        confidence = result.confidence;
    }
    catch (_error) {
        reflection = `Aggregated from ${memories.length} memories on topic: ${topic || "general"}`;
        confidence = 0.5;
    }
    const reflectionId = `reflect_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    await mesh.add(reflection, {
        type: "reflection",
        topic: topic || "general",
        source_memory_count: memories.length,
        confidence,
        generated_at: new Date().toISOString(),
    });
    let yamoBlock = null;
    if (mesh.enableYamo) {
        yamoBlock = YamoEmitter.buildReflectBlock({
            topic: topic || "general",
            memoryCount: memories.length,
            agentId: mesh.agentId,
            reflection,
            confidence,
        });
        await mesh._emitYamoBlock("reflect", reflectionId, yamoBlock);
    }
    return {
        id: reflectionId,
        topic: topic || "general",
        reflection,
        confidence,
        sourceMemoryCount: memories.length,
        yamoBlock,
        createdAt: new Date().toISOString(),
    };
}
/**
 * RAPTOR-style hierarchical summarization (Sarthi et al. 2024).
 *
 * Recursively clusters memories by embedding similarity, summarizes each
 * cluster with the LLM, ingests summaries as a new memory layer, and
 * repeats with the summary layer as input. Tree levels are tagged via
 * metadata.type=summary_l1/l2/... and metadata.source_memory_ids links
 * each summary back to the memories it covers. All summaries land in
 * the same vector index, so search() naturally returns them alongside
 * leaves — a query that matches the summary level retrieves an
 * abstracted answer; a query that matches a leaf retrieves the
 * concrete fact.
 *
 * Returns the per-level breakdown and the root summary id (if a single
 * root emerged). No-op (returns zeros) when the LLM is disabled or no
 * memories satisfy the topic/limit.
 */
export async function raptor(mesh, options = {}) {
    await mesh.init();
    const out = { levelsBuilt: 0, summariesCreated: 0, perLevel: [], treeRootId: undefined };
    if (!mesh.enableLLM || !mesh.llmClient) {
        if (process.env.YAMO_DEBUG === 'true') {
            logger.debug('raptor() skipped: LLM disabled');
        }
        return out;
    }
    const { topic, limit = 100, maxLevels = 3, branchingFactor = 5, minClusterSize = 2, } = options;
    // Seed leaves. LanceDB returns vectors as Float32Array; normalize to
    // a plain number[] so downstream math is straightforward.
    const toArray = (v) => {
        if (!v || typeof v.length !== 'number' || v.length === 0)
            return null;
        return Array.isArray(v) ? v : Array.from(v);
    };
    let currentLayer = [];
    if (topic) {
        // Topic-scoped: use vector search to gather thematically related leaves
        const hits = await mesh.search(topic, { limit, mode: 'vector', useCache: false });
        for (const h of hits) {
            const rec = mesh.client ? await mesh.client.getById(h.id) : null;
            const vector = rec ? toArray(rec.vector) : null;
            if (vector) {
                currentLayer.push({ id: h.id, content: h.content ?? "", vector });
            }
        }
    }
    else {
        const all = await mesh.getAll({ limit });
        for (const r of all) {
            const vector = toArray(r.vector);
            if (vector) {
                currentLayer.push({ id: r.id, content: r.content, vector });
            }
        }
    }
    if (currentLayer.length === 0)
        return out;
    for (let level = 1; level <= maxLevels; level++) {
        // Terminal case: small enough to collapse into a single root
        if (currentLayer.length <= branchingFactor) {
            const root = await mesh._summarizeCluster(currentLayer, level);
            if (root) {
                out.treeRootId = root.id;
                out.summariesCreated++;
                out.perLevel.push({ level, clusters: 1, summaries: 1 });
                out.levelsBuilt++;
            }
            break;
        }
        const k = Math.max(2, Math.ceil(currentLayer.length / branchingFactor));
        const clusters = mesh._kmeansClusters(currentLayer, k);
        const eligible = clusters.filter((c) => c.length >= minClusterSize);
        const summaries = await Promise.all(eligible.map((c) => mesh._summarizeCluster(c, level)));
        const validSummaries = summaries.filter((s) => s !== null);
        out.summariesCreated += validSummaries.length;
        out.perLevel.push({ level, clusters: clusters.length, summaries: validSummaries.length });
        out.levelsBuilt++;
        if (validSummaries.length === 0)
            break;
        currentLayer = validSummaries;
    }
    return out;
}
/**
 * K-means clustering with cosine distance. Vectors are assumed L2-normalized
 * (which they are — embedding service normalizes on output), so cosine
 * similarity is the dot product and centroids stay on the unit hypersphere
 * after mean + renormalize. Random-init centroids; k-means++ would be
 * better for stability but is overkill for this use case.
 * @private
 */
export function _kmeansClusters(_mesh, items, k, maxIters = 50) {
    if (items.length === 0)
        return [];
    if (k >= items.length)
        return items.map((it) => [it]);
    const dim = items[0].vector.length;
    // Initialize with k random distinct items.
    const centroids = [];
    const used = new Set();
    while (centroids.length < k) {
        const idx = Math.floor(Math.random() * items.length);
        if (used.has(idx))
            continue;
        used.add(idx);
        centroids.push([...items[idx].vector]);
    }
    const dot = (a, b) => {
        let s = 0;
        for (let i = 0; i < a.length; i++)
            s += a[i] * b[i];
        return s;
    };
    const assignments = new Array(items.length).fill(0);
    for (let iter = 0; iter < maxIters; iter++) {
        let changed = false;
        for (let i = 0; i < items.length; i++) {
            let best = 0;
            let bestSim = -Infinity;
            for (let c = 0; c < k; c++) {
                const sim = dot(items[i].vector, centroids[c]);
                if (sim > bestSim) {
                    bestSim = sim;
                    best = c;
                }
            }
            if (assignments[i] !== best) {
                assignments[i] = best;
                changed = true;
            }
        }
        if (!changed)
            break;
        // Update centroids: mean of assigned vectors, then L2-normalize.
        for (let c = 0; c < k; c++) {
            const sum = new Array(dim).fill(0);
            let count = 0;
            for (let i = 0; i < items.length; i++) {
                if (assignments[i] !== c)
                    continue;
                for (let d = 0; d < dim; d++)
                    sum[d] += items[i].vector[d];
                count++;
            }
            if (count === 0)
                continue;
            const mean = sum.map((v) => v / count);
            const mag = Math.sqrt(mean.reduce((s, v) => s + v * v, 0));
            centroids[c] = mag > 0 ? mean.map((v) => v / mag) : mean;
        }
    }
    const clusters = Array.from({ length: k }, () => []);
    for (let i = 0; i < items.length; i++) {
        clusters[assignments[i]].push(items[i]);
    }
    return clusters.filter((c) => c.length > 0);
}
/**
 * LLM-summarize a cluster of memories and store the summary as a memory
 * with type=summary_l{level} and source_memory_ids linking back to leaves.
 * skipDedup is set so the summary doesn't get collapsed against the very
 * memories it summarizes.
 * @private
 */
export async function _summarizeCluster(mesh, cluster, level) {
    if (!cluster || cluster.length === 0)
        return null;
    // Singleton: promote the item as-is to the next level. Avoids burning
    // an LLM call on a no-op summary.
    if (cluster.length === 1) {
        return cluster[0].vector
            ? { id: cluster[0].id, content: cluster[0].content, vector: cluster[0].vector }
            : null;
    }
    if (!mesh.enableLLM || !mesh.llmClient)
        return null;
    const timeoutMs = parseInt(process.env.RAPTOR_TIMEOUT_MS || '15000', 10);
    const systemPrompt = 'You are a summarization agent. Given several related memory entries, produce a concise abstractive summary (2-4 sentences) that captures the key information and shared themes. Synthesize — do not list verbatim. Output only the summary text, no preamble or commentary.';
    const userPrompt = cluster.map((m, i) => `[${i + 1}] ${m.content}`).join('\n\n');
    let timeoutHandle;
    let summary;
    try {
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('RAPTOR summarize timeout')), timeoutMs);
        });
        const response = await Promise.race([
            mesh.llmClient.complete(systemPrompt, userPrompt),
            timeoutPromise,
        ]);
        summary = typeof response === 'string' ? response.trim() : '';
    }
    catch (error) {
        if (process.env.YAMO_DEBUG === 'true') {
            logger.debug({ err: error, clusterSize: cluster.length, level }, 'RAPTOR summarization failed');
        }
        return null;
    }
    finally {
        if (timeoutHandle)
            clearTimeout(timeoutHandle);
    }
    if (!summary)
        return null;
    try {
        const mem = await mesh.add(summary, {
            type: `summary_l${level}`,
            source_memory_ids: cluster.map((c) => c.id),
            cluster_size: cluster.length,
            generated_by: 'raptor',
            generated_at: new Date().toISOString(),
            skipDedup: true,
        });
        // We need the stored vector for the next clustering round. Use the
        // embedding cache rather than a second DB round-trip.
        const vector = await mesh.embeddingFactory.embed(summary);
        return { id: mem.id, content: summary, vector };
    }
    catch (error) {
        if (process.env.YAMO_DEBUG === 'true') {
            logger.debug({ err: error, level }, 'RAPTOR summary ingest failed');
        }
        return null;
    }
}
