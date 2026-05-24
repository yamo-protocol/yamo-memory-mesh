/**
 * LLMClient provides unified interface for calling various LLM providers
 * to generate reflections from memory contexts.
 */
export declare class LLMClient {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
    timeout: number;
    maxRetries: number;
    maxTokens: number;
    stats: {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        fallbackCount: number;
    };
    /**
     * Create a new LLMClient instance
     */
    constructor(config?: {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
        maxTokens?: number;
        timeout?: number;
        maxRetries?: number;
    });
    /**
     * Get default model for provider
     * @private
     */
    _getDefaultModel(): string;
    /**
     * Get default base URL for provider
     * @private
     */
    _getDefaultBaseUrl(): string;
    /**
     * Generate reflection from memories
     * Main entry point for reflection generation
     */
    reflect(prompt: string, memories: any[]): Promise<any>;
    /**
     * Complete a prompt with system prompt guidance
     */
    complete(systemPrompt: string, userContent?: string): Promise<any>;
    /**
     * Format memories for LLM consumption
     * @private
     */
    _formatMemoriesForLLM(prompt: string, memories: any[]): string;
    /**
     * Call LLM with retry logic
     * @private
     */
    _callWithRetry(systemPrompt: string, userContent: string): Promise<any>;
    /**
     * Call LLM based on provider
     * @private
     */
    _callLLM(systemPrompt: string, userContent: string): Promise<any>;
    /**
     * Call OpenAI API
     * @private
     */
    _callOpenAI(systemPrompt: string, userContent: string): Promise<any>;
    /**
     * Call Anthropic (Claude) API
     * @private
     */
    _callAnthropic(systemPrompt: string, userContent: string): Promise<any>;
    /**
     * Call Ollama (local) API
     * @private
     */
    _callOllama(systemPrompt: string, userContent: string): Promise<any>;
    /**
     * Fallback when LLM fails
     * @private
     */
    _fallback(reason: string, memories?: any[]): {
        reflection: string;
        confidence: number;
    };
    /**
     * Sleep utility
     * @private
     */
    _sleep(ms: number): Promise<unknown>;
    /**
     * Get client statistics
     * @returns {Object} Statistics
     */
    getStats(): {
        successRate: string;
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        fallbackCount: number;
    };
    /**
     * Reset statistics
     */
    resetStats(): void;
}
export default LLMClient;
