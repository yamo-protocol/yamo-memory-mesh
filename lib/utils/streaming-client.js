import { fileURLToPath } from 'url';
import https from "https";

/**
 * Streaming LLM Client
 */
class StreamingClient {
    constructor(config) {
        this.config = config;
        this.buffer = '';
    }

    stream(payload, onToken, onComplete, onError) {
        const url = new URL(this.config.endpoint);
        
        /** @type {any} */
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

        const req = https.request(options, (res) => {
            let fullResponse = '';
            res.on('data', (chunk) => {
                this.buffer += chunk.toString();
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(data);
                            const token = this.extractToken(parsed, this.config.schema);
                            if (token) {
                                fullResponse += token;
                                onToken(token, parsed);
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            });
            res.on('end', () => { if (onComplete) onComplete(fullResponse); });
            res.on('error', (e) => { if (onError) onError(e); });
        });

        req.on('error', (e) => { if (onError) onError(e); });
        req.setTimeout(60000, () => {
            req.destroy();
            if (onError) onError(new Error('Timeout'));
        });
        req.write(JSON.stringify({ ...payload, stream: true }));
        req.end();
        return req;
    }

    extractToken(data, schema) {
        switch (schema) {
            case 'openai': return data.choices?.[0]?.delta?.content || '';
            default: return data.choices?.[0]?.delta?.content || data.delta?.text || '';
        }
    }

    async request(payload) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.config.endpoint);
            
            /** @type {any} */
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
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(JSON.stringify(payload));
            req.end();
        });
    }
}

class StreamingLLM {
    constructor(config) {
        this.client = new StreamingClient(config);
        this.config = config;
    }

    async streamToConsole(payload, options = {}) {
        // @ts-ignore
        const prefix = options.prefix || '';
        return new Promise((resolve, reject) => {
            let tokens = [];
            this.client.stream(payload, (token) => {
                process.stdout.write(token);
                // @ts-ignore
                tokens.push(token);
            }, (full) => {
                process.stdout.write('\n');
                resolve({ content: full, tokens: tokens.length });
            }, (e) => {
                process.stdout.write('\n');
                reject(e);
            });
        });
    }
}

export { StreamingClient, StreamingLLM };
