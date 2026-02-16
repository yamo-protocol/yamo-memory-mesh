/**
 * LLMClient provides unified interface for calling various LLM providers
 * to generate reflections from memory contexts.
 */
export declare class LLMClient {
    provider: any;
    apiKey: any;
    model: any;
    baseUrl: any;
    timeout: any;
    maxRetries: any;
    maxTokens: any;
    stats: any;
    /**
     * Create a new LLMClient instance
     */
    constructor(config?: {});
    /**
     * Get default model for provider
     * @private
     */
    _getDefaultModel(): any;
    /**
     * Get default base URL for provider
     * @private
     */
    _getDefaultBaseUrl(): any;
    /**
     * Generate reflection from memories
     * Main entry point for reflection generation
     */
    reflect(prompt: any, memories: any): Promise<any>;
    /**
     * Format memories for LLM consumption
     * @private
     */
    _formatMemoriesForLLM(prompt: any, memories: any): string;
    /**
     * Call LLM with retry logic
     * @private
     */
    _callWithRetry(systemPrompt: any, userContent: any): Promise<any>;
    /**
     * Call LLM based on provider
     * @private
     */
    _callLLM(systemPrompt: any, userContent: any): Promise<any>;
    /**
     * Call OpenAI API
     * @private
     */
    _callOpenAI(systemPrompt: any, userContent: any): Promise<any>;
    /**
     * Call Anthropic (Claude) API
     * @private
     */
    _callAnthropic(systemPrompt: any, userContent: any): Promise<any>;
    /**
     * Call Ollama (local) API
     * @private
     */
    _callOllama(systemPrompt: any, userContent: any): Promise<any>;
    /**
     * Fallback when LLM fails
     * @private
     */
    _fallback(reason: any, memories?: any[]): {
        reflection: string;
        confidence: number;
    };
    /**
     * Sleep utility
     * @private
     */
    _sleep(ms: any): Promise<unknown>;
    /**
     * Get client statistics
     * @returns {Object} Statistics
     */
    getStats(): any;
    /**
     * Reset statistics
     */
    resetStats(): void;
}
export default LLMClient;
