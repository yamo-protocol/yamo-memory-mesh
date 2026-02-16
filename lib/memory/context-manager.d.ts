export declare class MemoryContextManager {
    #private;
    /**
     * Create a new MemoryContextManager
     */
    constructor(config?: {});
    /**
     * Initialize the memory context manager
     */
    initialize(): Promise<void>;
    /**
     * Capture an interaction as memory
     */
    captureInteraction(prompt: any, response: any, context?: {}): Promise<any>;
    /**
     * Recall relevant memories for a query
     */
    recallMemories(query: any, options?: {}): Promise<any>;
    /**
     * Format memories for inclusion in prompt
     */
    formatMemoriesForPrompt(memories: any, options?: {}): string;
    clearCache(): void;
    getCacheStats(): {
        size: number;
        maxSize: number;
        ttlMs: number;
    };
    healthCheck(): Promise<{
        status: string;
        timestamp: string;
        initialized: boolean;
        checks: {};
    }>;
    /**
     * Dispose of resources (cleanup timer and cache)
     * Call this when the MemoryContextManager is no longer needed
     */
    dispose(): void;
}
export default MemoryContextManager;
