import type { MemoryMesh, RankedMemory } from "../memory-mesh.js";
export declare function _applyGraphRagBoosting(mesh: MemoryMesh, results: RankedMemory[], query: string): Promise<RankedMemory[]>;
/**
 * Canonicalize an entity string for graph storage and matching.
 * Lowercase, leading '#' stripped, hyphens/underscores → spaces,
 * trailing plural 's' stripped, whitespace collapsed. Lets the graph
 * unify "JWT", "jwt", "JWTs", "JWT-Token" / "jwt-tokens" etc.
 * @private
 */
export declare function _canonicalizeEntity(mesh: MemoryMesh, entity: string): string;
/**
 * Check if a content string mentions an entity using a case-insensitive
 * word-boundary regex with simple plural tolerance. Fixes the substring
 * false positives of the old `content.includes(entity)` check (where
 * "Auth" matched "AuthService" or "auth-token" matched "authorization").
 * @private
 */
export declare function _contentMentions(mesh: MemoryMesh, content: string, entity: string): boolean;
/**
 * Heuristic triple extractor — pairs consecutive PascalCase tokens with
 * a between-window verb guess. Produces low-precision edges that pollute
 * the Graph-RAG boost step. Disabled by default — return [] so no graph
 * noise from non-LLM writes.
 *
 * Opt in via GRAPH_RAG_HEURISTIC_TRIPLES=on env when running against a
 * corpus where you actually want PascalCase-pairing as a backstop. The
 * LLM path (_extractTriplesLLM) is the recommended graph source.
 */
export declare function _extractTriplesHeuristics(mesh: MemoryMesh, content: string): {
    source: string;
    target: string;
    relation: string;
    weight: number;
}[];
export declare function _extractTriplesLLM(mesh: MemoryMesh, content: string): Promise<{
    source: string;
    target: string;
    relation: string;
    weight: any;
}[]>;
