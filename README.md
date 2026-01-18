# MemoryMesh

Portable, semantic memory system for AI agents with automatic Layer 0 sanitization.

## Features

- **Persistent Vector Storage**: Powered by LanceDB.
- **Layer 0 Scrubber**: Automatically sanitizes, deduplicates, and cleans content.
- **Local Embeddings**: Runs 100% locally using ONNX (no API keys required).
- **Portable CLI**: Simple JSON-based interface for any agent or language.

## Installation

```bash
npm install @yamo/memory-mesh
```

## Usage

### CLI

```bash
# Store a memory (automatically scrubbed & embedded)
memory-mesh store "My important memory" '{"tag":"test"}'

# Search memories
memory-mesh search "query" 5

# Scrub content only
scrubber scrub "Raw text content"
```

### Node.js API

```javascript
import { MemoryMesh } from '@yamo/memory-mesh';

const mesh = new MemoryMesh();
await mesh.add('Content', { meta: 'data' });
const results = await mesh.search('query');
```

## Using in a Project

To use MemoryMesh with your Claude Code skills (like `yamo-super`) in a new project:

### 1. Install the Package
This installs the heavy dependencies (LanceDB, ONNX) and binaries.

```bash
npm install @yamo/memory-mesh
# Or install locally if developing:
# npm install /path/to/memory-mesh
```

### 2. Setup the CLI Adapter
YAMO skills learn how to use the memory system by reading the source code of the CLI adapter. You must ensure `tools/memory_mesh.js` exists in your project so the agent can "see" the interface.

**Quick Setup:**
```bash
mkdir -p tools
cp node_modules/@yamo/memory-mesh/bin/memory_mesh.js tools/memory_mesh.js
```

### 3. Run Your Skill
Your `yamo-super` skill (or any skill referencing `memory_script;tools/memory_mesh.js`) will now work automatically.

```bash
claude "Run yamo-super task='Setup CI pipeline'"
```

The agent will read `tools/memory_mesh.js`, understand how to call it, and execute memory operations which are handled by the installed `@yamo/memory-mesh` package.

## Docker

```bash
docker run -v $(pwd)/data:/app/runtime/data \
  yamo/memory-mesh store "Content"
```

