#!/usr/bin/env node

/**
 * MemoryMesh CLI Entry Point
 * Delegates to the core CLI handler in lib/memory/memory-mesh.js
 */

import { run } from '../lib/memory/memory-mesh.js';

// Execute the main CLI handler
run().catch(err => {
  console.error(`❌ Fatal Error: ${err.message}`);
  process.exit(1);
});