import { fileURLToPath } from 'url';
import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Vector Memory Manager
 * Lightweight vector database for YAMO Skills
 * Uses simple cosine similarity for semantic search
 *
 * NOTE: This is a lightweight implementation. For production with large datasets,
 * consider integrating LanceDB: npm install @lancedb/lancedb
 */
class VectorMemory {
    constructor(options = {}) {
        this.storePath = options.storePath || path.join(__dirname, '..', 'data', 'vector_memory.json');
        this.embeddingDim = options.embeddingDim || 384; // Default for sentence transformers
        this.maxEntries = options.maxEntries || 10000;
        this.ensureStorageDirectory();
        this.load();
    }

    /**
     * Ensure storage directory exists
     */
    ensureStorageDirectory() {
        const dir = path.dirname(this.storePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Load existing memory from disk
     */
    load() {
        if (fs.existsSync(this.storePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
                this.memories = data.memories || [];
                this.metadata = data.metadata || { version: '1.0', created: new Date().toISOString() };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error('Failed to load vector memory:', message);
                this.vectorStore = [];
            }
        } else {
            this.memories = [];
            this.metadata = { version: '1.0', created: new Date().toISOString() };
        }
    }

    /**
     * Save memory to disk
     */
    save() {
        const data = {
            metadata: {
                ...this.metadata,
                last_updated: new Date().toISOString(),
                entry_count: this.memories.length
            },
            memories: this.memories
        };

        fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
    }

    /**
     * Generate a simple embedding from text
     * NOTE: This is a basic implementation. For production, use a proper embedding model like:
     * - sentence-transformers (Python)
     * - @xenova/transformers (JavaScript)
     * - OpenAI embeddings API
     */
    generateEmbedding(text) {
        // Simple word-based embedding (not semantic, but functional for demo)
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(this.embeddingDim).fill(0);

        // Hash each word and update embedding
        words.forEach((word, idx) => {
            const hash = crypto.createHash('sha256').update(word).digest();
            for (let i = 0; i < this.embeddingDim; i++) {
                embedding[i] += hash[i % hash.length] / 255;
            }
        });

        // Normalize
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return embedding.map(val => val / (magnitude || 1));
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    cosineSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length) {
            throw new Error('Vectors must have same dimensions');
        }

        const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));

        return dotProduct / ((magnitudeA * magnitudeB) || 1);
    }

    /**
     * Store a memory with automatic embedding generation
     * @param {string} content - Text content to store
     * @param {Object} metadata - Additional metadata
     * @returns {Object} - Created memory entry
     */
    store(content, metadata = {}) {
        const embedding = this.generateEmbedding(content);

        const memory = {
            id: crypto.randomUUID(),
            content,
            embedding,
            metadata: {
                ...metadata,
                created_at: new Date().toISOString(),
                content_length: content.length
            }
        };

        this.memories.push(memory);

        // Enforce max entries (FIFO)
        if (this.memories.length > this.maxEntries) {
            this.memories.shift();
        }

        this.save();
        return memory;
    }

    /**
     * Search for similar memories
     * @param {string} query - Search query
     * @param {number} topK - Number of results to return
     * @param {number} threshold - Minimum similarity threshold (0-1)
     * @returns {Array} - Array of matching memories with scores
     */
    search(query, topK = 5, threshold = 0.0) {
        const queryEmbedding = this.generateEmbedding(query);

        // Calculate similarity for all memories
        const results = this.memories.map(memory => ({
            ...memory,
            similarity: this.cosineSimilarity(queryEmbedding, memory.embedding)
        }));

        // Filter by threshold and sort by similarity
        return results
            .filter(r => r.similarity >= threshold)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK)
            .map(({ embedding, ...rest }) => rest); // Remove embedding from results
    }

    /**
     * Retrieve memory by ID
     */
    retrieve(id) {
        return this.memories.find(m => m.id === id);
    }

    /**
     * Delete memory by ID
     */
    delete(id) {
        const initialLength = this.memories.length;
        this.memories = this.memories.filter(m => m.id !== id);

        if (this.memories.length < initialLength) {
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Clear all memories
     */
    clear() {
        this.memories = [];
        this.save();
    }

    /**
     * Get statistics about stored memories
     */
    stats() {
        return {
            total_memories: this.memories.length,
            embedding_dim: this.embeddingDim,
            max_entries: this.maxEntries,
            storage_path: this.storePath,
            metadata: this.metadata,
            avg_content_length: this.memories.length > 0
                ? Math.round(this.memories.reduce((sum, m) => sum + m.metadata.content_length, 0) / this.memories.length)
                : 0
        };
    }

    /**
     * Semantic clustering (group similar memories)
     */
    cluster(similarityThreshold = 0.7) {
        const clusters = [];
        const processed = new Set();

        this.memories.forEach((memory, idx) => {
            if (processed.has(idx)) return;

            const cluster = {
                representative: memory.content.substring(0, 100),
                members: [{ id: memory.id, content: memory.content }]
            };

            // Find similar memories
            this.memories.forEach((other, otherIdx) => {
                if (idx === otherIdx || processed.has(otherIdx)) return;

                const similarity = this.cosineSimilarity(memory.embedding, other.embedding);
                if (similarity >= similarityThreshold) {
                    cluster.members.push({ id: other.id, content: other.content });
                    processed.add(otherIdx);
                }
            });

            processed.add(idx);
            clusters.push(cluster);
        });

        return clusters;
    }

    /**
     * Export memories to JSON
     */
    export() {
        return {
            metadata: this.metadata,
            memories: this.memories.map(({ embedding, ...rest }) => rest)
        };
    }

    /**
     * Import memories from JSON
     */
    import(data) {
        if (data.memories) {
            data.memories.forEach(memory => {
                if (!memory.embedding) {
                    memory.embedding = this.generateEmbedding(memory.content);
                }
                this.memories.push(memory);
            });
            this.save();
        }
    }
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const memory = new VectorMemory();
    const command = process.argv[2];

    if (command === 'store') {
        const content = process.argv.slice(3).join(' ');
        if (!content) {
            console.log('Usage: node vector_memory.js store <content>');
            process.exit(1);
        }

        const result = memory.store(content, { source: 'cli' });
        console.log('✅ Stored:', result.id);
        console.log('   Content:', content.substring(0, 100) + '...');

    } else if (command === 'search') {
        const query = process.argv.slice(3).join(' ');
        if (!query) {
            console.log('Usage: node vector_memory.js search <query>');
            process.exit(1);
        }

        const results = memory.search(query, 5);
        console.log(`\n🔍 Search results for: "${query}"\n`);

        if (results.length === 0) {
            console.log('No results found');
        } else {
            results.forEach((result, idx) => {
                console.log(`${idx + 1}. [${(result.similarity * 100).toFixed(1)}%] ${result.content.substring(0, 100)}...`);
                console.log(`   ID: ${result.id}`);
                console.log(`   Created: ${result.metadata.created_at}`);
                console.log('');
            });
        }

    } else if (command === 'stats') {
        const stats = memory.stats();
        console.log('\n📊 Vector Memory Statistics\n');
        console.log(`Total Memories: ${stats.total_memories}`);
        console.log(`Embedding Dimensions: ${stats.embedding_dim}`);
        console.log(`Max Entries: ${stats.max_entries}`);
        console.log(`Average Content Length: ${stats.avg_content_length} chars`);
        console.log(`Storage Path: ${stats.storage_path}`);

    } else if (command === 'cluster') {
        const clusters = memory.cluster(0.7);
        console.log(`\n🔗 Found ${clusters.length} clusters\n`);

        clusters.forEach((cluster, idx) => {
            console.log(`Cluster ${idx + 1}: ${cluster.members.length} memories`);
            console.log(`  Representative: ${cluster.representative}...`);
            console.log('');
        });

    } else if (command === 'clear') {
        memory.clear();
        console.log('✅ All memories cleared');

    } else if (command === 'test') {
        console.log('🧪 Testing Vector Memory\n');

        // Store some test memories
        console.log('Storing test memories...');
        memory.store('How to implement authentication in Node.js using JWT', { type: 'tutorial' });
        memory.store('Best practices for securing API endpoints', { type: 'security' });
        memory.store('Node.js JWT authentication guide', { type: 'tutorial' });
        memory.store('How to use Docker for development', { type: 'devops' });
        memory.store('Setting up HTTPS with Let\'s Encrypt', { type: 'security' });

        console.log('✅ Stored 5 test memories\n');

        // Search
        console.log('Searching for "JWT authentication"...');
        const results = memory.search('JWT authentication', 3);
        console.log(`Found ${results.length} results:\n`);

        results.forEach((result, idx) => {
            console.log(`${idx + 1}. [${(result.similarity * 100).toFixed(1)}%] ${result.content}`);
        });

        console.log('\n✅ Test completed');

    } else {
        console.log('YAMO Vector Memory CLI');
        console.log('Usage:');
        console.log('  node vector_memory.js store <content>  - Store a memory');
        console.log('  node vector_memory.js search <query>   - Search for similar memories');
        console.log('  node vector_memory.js stats            - Show statistics');
        console.log('  node vector_memory.js cluster          - Find semantic clusters');
        console.log('  node vector_memory.js clear            - Clear all memories');
        console.log('  node vector_memory.js test             - Run test');
    }
}

export default VectorMemory;
