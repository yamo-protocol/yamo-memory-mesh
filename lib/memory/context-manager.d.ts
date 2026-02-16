/**
 * MemoryContextManager - High-level memory management for YAMO
 */
import { MemoryMesh } from "./memory-mesh.js";
export interface MemoryContextConfig {
    mesh?: MemoryMesh;
    autoInit?: boolean;
    enableCache?: boolean;
    recallLimit?: number;
    minImportance?: number;
    silent?: boolean;
}
export declare class MemoryContextManager {
    #private;
    /**
     * Create a new MemoryContextManager
     */
    constructor(config?: MemoryContextConfig);
    /**
     * Initialize the memory context manager
     */
    initialize(): Promise<void>;
    /**
     * Capture an interaction as memory
     */
    captureInteraction(prompt: string, response: string, context?: any): Promise<any>;
    /**
     * Recall relevant memories for a query
     */
    recallMemories(query: string, options?: any): Promise<any[]>;
    /**
     * Format memories for inclusion in prompt
     */
    formatMemoriesForPrompt(memories: any[], options?: any): string;
    clearCache(): void;
    getCacheStats(): any;
    healthCheck(): Promise<any>;
    /**
     * Dispose of resources (cleanup timer and cache)
     * Call this when the MemoryContextManager is no longer needed
     */
    dispose(): void;
}
export default MemoryContextManager;
