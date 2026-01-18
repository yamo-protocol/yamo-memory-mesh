# MemoryMesh

Portable, semantic memory system for AI agents with automatic Layer 0 sanitization.

## Features

- **Persistent Vector Storage**: Powered by LanceDB for semantic search.
- **Layer 0 Scrubber**: Automatically sanitizes, deduplicates, and cleans content before embedding.
- **Local Embeddings**: Runs 100% locally using ONNX (no API keys required).
- **Portable CLI**: Simple JSON-based interface for any agent or language.
- **YAMO Skills Integration**: Includes yamo-super workflow system with automatic memory learning.
- **Pattern Recognition**: Workflows automatically store and retrieve execution patterns for optimization.

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

```bash
npm install @yamo/memory-mesh
```

### 2. Run Setup

This installs YAMO skills to `~/.claude/skills/memory-mesh/` and tools to `./tools/`:

```bash
npx memory-mesh-setup
```

The setup script will:
- Copy YAMO skills (`yamo-super`, `scrubber`) to Claude Code
- Copy CLI tools to your project's `tools/` directory
- Prompt before overwriting existing files

### 3. Use the Skills

Your skills are now available in Claude Code with automatic memory integration:

```bash
# Use yamo-super workflow system
# Automatically retrieves similar past workflows and stores execution patterns
claude /yamo-super

# Use scrubber skill for content sanitization
claude /scrubber content="raw text"
```

**Memory Integration Features:**
- **Workflow Orchestrator**: Searches for similar past workflows before starting
- **Design Phase**: Stores validated designs with metadata
- **Debug Phase**: Retrieves similar bug patterns and stores resolutions
- **Review Phase**: Stores code review outcomes and quality metrics
- **Complete Workflow**: Stores full execution pattern for future optimization

YAMO agents will automatically find tools in `tools/memory_mesh.js` and `tools/scrubber.js`.

## Docker

```bash
docker run -v $(pwd)/data:/app/runtime/data \
  yamo/memory-mesh store "Content"
```

