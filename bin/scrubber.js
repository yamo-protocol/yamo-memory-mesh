#!/usr/bin/env node

/**
 * Scrubber CLI Tool
 * 
 * A portable CLI wrapper for the S-MORA Layer 0 Scrubber.
 * Sanitizes, deduplicates, and cleans text content.
 * 
 * Usage:
 *   node tools/scrubber.js scrub "some text content"
 *   node tools/scrubber.js scrub-file path/to/file.md
 * 
 * Output:
 *   JSON object with { success, cleaned_content, metadata }
 */

import { Scrubber } from '../lib/smora/scrubber/scrubber.js';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const command = args[0];
const input = args[1];

async function main() {
    // Initialize with default aggressive cleaning
    const scrubber = new Scrubber({
        enabled: true,
        structural: { stripHTML: true, normalizeMarkdown: true },
        semantic: { removeBoilerplate: true },
        chunking: { minTokens: 1 } // Allow short inputs
    });

    try {
        let content = '';
        let source = 'cli-input';
        let type = 'txt';

        if (command === 'scrub') {
            if (!input) throw new Error('Content argument required');
            content = input;
        } else if (command === 'scrub-file') {
            if (!input) throw new Error('File path argument required');
            if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
            content = fs.readFileSync(input, 'utf8');
            source = path.basename(input);
            type = path.extname(input).replace('.', '') || 'txt';
        } else {
            console.error(JSON.stringify({ error: `Unknown command: ${command}` }));
            console.error('Usage: node tools/scrubber.js [scrub|scrub-file] <input>');
            process.exit(1);
        }

        const result = await scrubber.process({
            content,
            source,
            type
        });

        // Reassemble chunks for simple return
        const cleanedContent = result.chunks.map(c => c.text).join('\n\n');

        console.log(JSON.stringify({
            success: true,
            original_length: content.length,
            cleaned_length: cleanedContent.length,
            cleaned_content: cleanedContent,
            chunks: result.chunks.length,
            metadata: result.metadata
        }));

    } catch (error) {
        console.error(JSON.stringify({
            success: false,
            error: error.message
        }));
        process.exit(1);
    }
}

main();
