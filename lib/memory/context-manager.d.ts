export declare class MemoryContextManager {
    #private;
    /**
     * Create a new MemoryContextManager
     */
    constructor(config?: Record<string, any>);
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
    recallMemories(query: string, options?: {
        limit?: number;
        useCache?: boolean;
        memoryType?: string | null;
        skillName?: string | null;
    }): Promise<any>;
    /**
     * Format memories for inclusion in prompt
     */
    formatMemoriesForPrompt(memories: any[], options?: any): string;
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
        checks: Record<string, any>;
    }>;
    /**
     * Dispose of resources (cleanup timer and cache)
     * Call this when the MemoryContextManager is no longer needed
     */
    dispose(): void;
}
export default MemoryContextManager;
