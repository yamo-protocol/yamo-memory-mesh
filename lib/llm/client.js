/**
 * LLM Client - Multi-provider LLM API client for reflection generation
 *
 * Supports:
 * - OpenAI (GPT-4, GPT-4o-mini, etc.)
 * - Anthropic (Claude)
 * - Ollama (local models)
 * - Graceful fallback when LLM unavailable
 */
import { createLogger } from "../utils/logger.js";
const logger = createLogger("llm-client");
/**
 * LLMClient provides unified interface for calling various LLM providers
 * to generate reflections from memory contexts.
 */
export class LLMClient {
    provider;
    apiKey;
    model;
    baseUrl;
    timeout;
    maxRetries;
    maxTokens;
    stats;
    /**
     * Create a new LLMClient instance
     */
    constructor(config = {}) {
        this.provider = config.provider || process.env.LLM_PROVIDER || "openai";
        this.apiKey = config.apiKey || process.env.LLM_API_KEY || "";
        this.model =
            config.model || process.env.LLM_MODEL || this._getDefaultModel();
        this.baseUrl =
            config.baseUrl || process.env.LLM_BASE_URL || this._getDefaultBaseUrl();
        this.maxTokens = config.maxTokens || 2000;
        this.timeout = config.timeout || (this.maxTokens >= 4000 ? 300000 : 60000);
        this.maxRetries = config.maxRetries || 2;
        // Statistics
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            fallbackCount: 0,
        };
    }
    /**
     * Get default model for provider
     * @private
     */
    _getDefaultModel() {
        const defaults = {
            openai: "gpt-4o-mini",
            anthropic: "claude-3-5-haiku-20241022",
            ollama: "llama3.2",
        };
        return defaults[this.provider] || "gpt-4o-mini";
    }
    /**
     * Get default base URL for provider
     * @private
     */
    _getDefaultBaseUrl() {
        const defaults = {
            openai: "https://api.openai.com/v1",
            anthropic: "https://api.anthropic.com/v1",
            ollama: "http://localhost:11434",
        };
        return defaults[this.provider] || "https://api.openai.com/v1";
    }
    /**
     * Generate reflection from memories
     * Main entry point for reflection generation
     */
    async reflect(prompt, memories) {
        this.stats.totalRequests++;
        if (!memories || memories.length === 0) {
            return this._fallback("No memories provided");
        }
        const systemPrompt = `You are a reflective AI agent. Review the provided memories and synthesize a high-level insight, belief, or observation.
Respond ONLY in JSON format with exactly these keys:
{
  "reflection": "a concise insight or observation derived from the memories",
  "confidence": 0.0 to 1.0
}

Keep the reflection brief (1-2 sentences) and actionable.`;
        const userContent = this._formatMemoriesForLLM(prompt, memories);
        try {
            const response = await this._callWithRetry(systemPrompt, userContent);
            const parsed = JSON.parse(response);
            // Validate response structure
            if (!parsed.reflection || typeof parsed.confidence !== "number") {
                throw new Error("Invalid LLM response format");
            }
            // Clamp confidence to valid range
            parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
            this.stats.successfulRequests++;
            return parsed;
        }
        catch (error) {
            this.stats.failedRequests++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.debug({ err: error, errorMessage }, "LLM call failed");
            return this._fallback("LLM error", memories);
        }
    }
    /**
     * Format memories for LLM consumption
     * @private
     */
    _formatMemoriesForLLM(prompt, memories) {
        const memoryList = memories
            .map((m, i) => `${i + 1}. ${m.content}`)
            .join("\n");
        return `Prompt: ${prompt}\n\nMemories:\n${memoryList}\n\nBased on these memories, provide a brief reflective insight.`;
    }
    /**
     * Call LLM with retry logic
     * @private
     */
    async _callWithRetry(systemPrompt, userContent) {
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await this._callLLM(systemPrompt, userContent);
            }
            catch (error) {
                lastError = error;
                if (attempt < this.maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                    await this._sleep(delay);
                }
            }
        }
        throw lastError;
    }
    /**
     * Call LLM based on provider
     * @private
     */
    async _callLLM(systemPrompt, userContent) {
        switch (this.provider) {
            case "openai":
                return this._callOpenAI(systemPrompt, userContent);
            case "anthropic":
                return this._callAnthropic(systemPrompt, userContent);
            case "ollama":
                return this._callOllama(systemPrompt, userContent);
            default:
                throw new Error(`Unsupported provider: ${this.provider}`);
        }
    }
    /**
     * Call OpenAI API
     * @private
     */
    async _callOpenAI(systemPrompt, userContent) {
        if (!this.apiKey) {
            throw new Error("OpenAI API key not configured");
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    temperature: 0.7,
                    max_tokens: this.maxTokens,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`OpenAI API error: ${response.status} - ${error}`);
            }
            const data = await response.json();
            return data.choices[0].message.content;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error("Request timeout");
            }
            throw error;
        }
    }
    /**
     * Call Anthropic (Claude) API
     * @private
     */
    async _callAnthropic(systemPrompt, userContent) {
        if (!this.apiKey) {
            throw new Error("Anthropic API key not configured");
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await fetch(`${this.baseUrl}/messages`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    system: systemPrompt,
                    messages: [{ role: "user", content: userContent }],
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Anthropic API error: ${response.status} - ${error}`);
            }
            const data = await response.json();
            return data.content[0].text;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error("Request timeout");
            }
            throw error;
        }
    }
    /**
     * Call Ollama (local) API
     * @private
     */
    async _callOllama(systemPrompt, userContent) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    stream: false,
                    options: {
                        num_predict: this.maxTokens,
                    },
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Ollama API error: ${response.status} - ${error}`);
            }
            const data = await response.json();
            return data.message.content;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error("Request timeout");
            }
            throw error;
        }
    }
    /**
     * Fallback when LLM fails
     * @private
     */
    _fallback(reason, memories = []) {
        this.stats.fallbackCount++;
        if (memories && memories.length > 0) {
            // Simple aggregation fallback
            const contents = memories.map((m) => m.content);
            const combined = contents.join("; ");
            const preview = combined.length > 200 ? `${combined.substring(0, 200)}...` : combined;
            return {
                reflection: `Aggregated from ${memories.length} memories: ${preview}`,
                confidence: 0.5,
            };
        }
        return {
            reflection: `Reflection generation unavailable: ${reason}`,
            confidence: 0.3,
        };
    }
    /**
     * Sleep utility
     * @private
     */
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Get client statistics
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalRequests > 0
                ? (this.stats.successfulRequests / this.stats.totalRequests).toFixed(2)
                : "0.00",
        };
    }
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            fallbackCount: 0,
        };
    }
}
export default LLMClient;
