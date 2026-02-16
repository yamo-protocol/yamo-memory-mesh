/**
 * LLM Client - Multi-provider LLM API client for reflection generation
 *
 * Supports:
 * - OpenAI (GPT-4, GPT-4o-mini, etc.)
 * - Anthropic (Claude)
 * - Ollama (local models)
 * - Graceful fallback when LLM unavailable
 */
export interface LLMConfig {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
    maxTokens?: number;
}
export interface ReflectionResult {
    reflection: string;
    confidence: number;
}
export interface LLMStats {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    fallbackCount: number;
}
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
    stats: LLMStats;
    /**
     * Create a new LLMClient instance
     */
    constructor(config?: LLMConfig);
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
    reflect(prompt: string, memories: any[]): Promise<ReflectionResult>;
    /**
     * Format memories for LLM consumption
     * @private
     */
    _formatMemoriesForLLM(prompt: string, memories: any[]): string;
    /**
     * Call LLM with retry logic
     * @private
     */
    _callWithRetry(systemPrompt: string, userContent: string): Promise<string>;
    /**
     * Call LLM based on provider
     * @private
     */
    _callLLM(systemPrompt: string, userContent: string): Promise<string>;
    /**
     * Call OpenAI API
     * @private
     */
    _callOpenAI(systemPrompt: string, userContent: string): Promise<string>;
    /**
     * Call Anthropic (Claude) API
     * @private
     */
    _callAnthropic(systemPrompt: string, userContent: string): Promise<string>;
    /**
     * Call Ollama (local) API
     * @private
     */
    _callOllama(systemPrompt: string, userContent: string): Promise<string>;
    /**
     * Fallback when LLM fails
     * @private
     */
    _fallback(reason: string, memories?: any[]): ReflectionResult;
    /**
     * Sleep utility
     * @private
     */
    _sleep(ms: number): Promise<void>;
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
