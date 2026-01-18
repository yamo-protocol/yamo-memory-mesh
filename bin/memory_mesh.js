#!/usr/bin/env node

/**
 * MemoryMesh CLI Adapter
 * Provides a portable interface for skills to interact with the MemoryMesh system.
 * 
 * Usage:
 *   node tools/memory_mesh.js store <content_string_or_json> [metadata_json]
 *   node tools/memory_mesh.js search <query_string> [limit]
 */

import { MemoryMesh } from '../lib/memory/memory-mesh.js';
import path from 'path';

// Parse arguments
const args = process.argv.slice(2);
const command = args[0];

async function main() {
    try {
        const mesh = new MemoryMesh();
        // Wait for initialization if necessary (MemoryMesh constructor usually doesn't await, 
        // but operations might need internal init. We assume standard usage.)

        if (command === 'store') {
            const content = args[1];
            let metadata = {};
            if (args[2]) {
                try {
                    metadata = JSON.parse(args[2]);
                } catch (e) {
                    console.error(JSON.stringify({ error: "Invalid metadata JSON" }));
                    process.exit(1);
                }
            }
            
            if (!content) {
                console.error(JSON.stringify({ error: "Content required for store command" }));
                process.exit(1);
            }

            const result = await mesh.add(content, metadata);
            console.log(JSON.stringify({ success: true, id: result.id, message: "Memory stored successfully" }));
            
        } else if (command === 'search') {
            const query = args[1];
            const limit = parseInt(args[2]) || 5;
            
            if (!query) {
                console.error(JSON.stringify({ error: "Query required for search command" }));
                process.exit(1);
            }

            const results = await mesh.search(query, { limit });
            console.log(JSON.stringify({ success: true, results: results }));
            
        } else {
            console.error(JSON.stringify({ error: `Unknown command: ${command}` }));
            console.error("Usage: node tools/memory_mesh.js [store|search] ...");
            process.exit(1);
        }

    } catch (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
    }
}

main();
