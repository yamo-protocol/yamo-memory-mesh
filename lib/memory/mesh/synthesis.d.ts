import type { MemoryMesh } from "../memory-mesh.js";
/**
 * Reflect on recent memories
 */
export declare function reflect(mesh: MemoryMesh, options?: {
    lookback?: number;
    topic?: string;
    generate?: boolean;
}): Promise<{
    topic: string | undefined;
    count: number;
    context: {
        content: any;
        type: any;
        id: any;
    }[];
    prompt: string;
    id?: undefined;
    reflection?: undefined;
    confidence?: undefined;
    sourceMemoryCount?: undefined;
    yamoBlock?: undefined;
    createdAt?: undefined;
} | {
    id: string;
    topic: string;
    reflection: string;
    confidence: number;
    sourceMemoryCount: number;
    yamoBlock: string | null;
    createdAt: string;
    count?: undefined;
    context?: undefined;
    prompt?: undefined;
}>;
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
export declare function raptor(mesh: MemoryMesh, options?: {
    topic?: string;
    limit?: number;
    maxLevels?: number;
    branchingFactor?: number;
    minClusterSize?: number;
}): Promise<{
    levelsBuilt: number;
    summariesCreated: number;
    perLevel: Array<{
        level: number;
        clusters: number;
        summaries: number;
    }>;
    treeRootId?: string;
}>;
/**
 * K-means clustering with cosine distance. Vectors are assumed L2-normalized
 * (which they are — embedding service normalizes on output), so cosine
 * similarity is the dot product and centroids stay on the unit hypersphere
 * after mean + renormalize. Random-init centroids; k-means++ would be
 * better for stability but is overkill for this use case.
 * @private
 */
export declare function _kmeansClusters<T extends {
    vector: number[];
}>(mesh: MemoryMesh, items: T[], k: number, maxIters?: number): T[][];
/**
 * LLM-summarize a cluster of memories and store the summary as a memory
 * with type=summary_l{level} and source_memory_ids linking back to leaves.
 * skipDedup is set so the summary doesn't get collapsed against the very
 * memories it summarizes.
 * @private
 */
export declare function _summarizeCluster(mesh: MemoryMesh, cluster: Array<{
    id: string;
    content: string;
    vector?: number[];
}>, level: number): Promise<{
    id: string;
    content: string;
    vector: number[];
} | null>;
