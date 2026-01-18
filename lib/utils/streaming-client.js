import { fileURLToPath } from 'url';
import https from "https";

/**
 * Streaming LLM Client
 * Supports real-time token streaming from LLM APIs
 */
class StreamingClient {
    constructor(config) {
        this.config = config;
        this.buffer = '';
    }

    /**
     * Make a streaming request to an LLM API
     * @param {Object} payload - Request payload
     * @param {Function} onToken - Callback for each token
     * @param {Function} onComplete - Callback when complete
     * @param {Function} onError - Callback for errors
     */
    stream(payload, onToken, onComplete, onError) {
        const url = new URL(this.config.endpoint);

        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Accept': 'text/event-stream'
            },
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2'
        };

        // Add streaming flag to payload
        const streamPayload = {
            ...payload,
            stream: true
        };

        const req = https.request(options, (res) => {
            let fullResponse = '';

            res.on('data', (chunk) => {
                this.buffer += chunk.toString();

                // Process SSE (Server-Sent Events) format
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);

                        // Check for stream end
                        if (data === '[DONE]') {
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const token = this.extractToken(parsed, this.config.schema);

                            if (token) {
                                fullResponse += token;
                                onToken(token, parsed);
                            }
                        } catch (error) {
                            // Skip invalid JSON
                        }
                    }
                }
            });

            res.on('end', () => {
                if (onComplete) {
                    onComplete(fullResponse);
                }
            });

            res.on('error', (error) => {
                if (onError) {
                    onError(error);
                }
            });
        });

        req.on('error', (error) => {
            if (onError) {
                onError(error);
            }
        });

        req.setTimeout(60000, () => {
            req.destroy();
            if (onError) {
                onError(new Error('Request timeout after 60s'));
            }
        });

        req.write(JSON.stringify(streamPayload));
        req.end();

        return req;
    }

    /**
     * Extract token from response based on provider schema
     */
    extractToken(data, schema) {
        switch (schema) {
            case 'openai':
            case 'zai_glm':
                return data.choices?.[0]?.delta?.content || '';

            case 'anthropic':
                if (data.type === 'content_block_delta') {
                    return data.delta?.text || '';
                }
                return '';

            default:
                return data.choices?.[0]?.delta?.content || data.delta?.text || '';
        }
    }

    /**
     * Non-streaming fallback
     */
    async request(payload) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.config.endpoint);

            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                rejectUnauthorized: true,
                minVersion: 'TLSv1.2'
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(JSON.stringify(payload));
            req.end();
        });
    }
}

/**
 * Streaming wrapper with progress indicators
 */
class StreamingLLM {
    constructor(config) {
        this.client = new StreamingClient(config);
        this.config = config;
    }

    /**
     * Stream with real-time display
     */
    streamToConsole(payload, options = {}) {
        const prefix = options.prefix || '';
        const showSpinner = options.spinner !== false;

        return new Promise((resolve, reject) => {
            let tokens = [];
            let charCount = 0;

            if (showSpinner) {
                process.stdout.write(`${prefix}\x1b[90m⋯\x1b[0m `);
            }

            this.client.stream(
                payload,
                (token) => {
                    // Clear spinner on first token
                    if (showSpinner && tokens.length === 0) {
                        process.stdout.write('\r\x1b[K' + prefix);
                    }

                    tokens.push(token);
                    process.stdout.write(token);
                    charCount += token.length;
                },
                (fullResponse) => {
                    process.stdout.write('\n');
                    resolve({
                        content: fullResponse,
                        tokens: tokens.length,
                        characters: charCount
                    });
                },
                (error) => {
                    process.stdout.write('\n');
                    reject(error);
                }
            );
        });
    }

    /**
     * Stream with custom handler
     */
    stream(payload, onToken, onComplete, onError) {
        return this.client.stream(payload, onToken, onComplete, onError);
    }

    /**
     * Non-streaming request
     */
    async request(payload) {
        return this.client.request(payload);
    }
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const config = {
        endpoint: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions',
        apiKey: process.env.OPENAI_API_KEY,
        schema: 'openai'
    };

    if (!config.apiKey) {
        console.error('❌ Please set OPENAI_API_KEY environment variable');
        process.exit(1);
    }

    const client = new StreamingLLM(config);

    const payload = {
        model: 'gpt-3.5-turbo',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Write a haiku about programming.' }
        ],
        max_tokens: 100
    };

    console.log('🌊 Streaming Response Demo\n');
    console.log('Question: Write a haiku about programming.\n');
    console.log('Response:');

    client.streamToConsole(payload, { prefix: '> ' })
        .then(result => {
            console.log(`\n📊 Stats: ${result.tokens} tokens, ${result.characters} characters`);
        })
        .catch(error => {
            console.error('❌ Error:', error.message);
        });
}

export { StreamingClient, StreamingLLM };
