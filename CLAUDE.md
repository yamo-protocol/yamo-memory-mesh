# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memory Mesh is a **portable semantic memory system for AI agents** with automatic Layer 0 sanitization. It combines LanceDB vector storage, local ONNX embeddings, and a deterministic 6-stage content scrubber for high-quality semantic search.

**Key characteristics:**
- 100% local-first (no API keys required for default config)
- Agent-discoverable CLI interface (agents read `tools/memory_mesh.js` source to understand the API)
- NPM-installable YAMO skills (yamo-super v2.1.0, scrubber) with automatic memory integration
- Workflow pattern recognition - automatically learns from past executions
- ES Module codebase targeting Node.js 18+
- No transpilation - TypeScript is used only for type checking

**Installation:**
```bash
npm install @yamo/memory-mesh
npx memory-mesh-setup  # Installs skills to ~/.claude/skills/ and tools to ./tools/
```

## Commands

### Development
```bash
# Type checking (primary validation method)
npm test                    # Runs tsc --noEmit
npm run type-check         # Same as above

# No build step - code runs directly as ESM
```

### CLI Tools
```bash
# Main memory operations
./bin/memory_mesh.js store "content" '{"tag":"value"}'
./bin/memory_mesh.js search "query" 5
./bin/memory_mesh.js get <id>
./bin/memory_mesh.js delete <id>
./bin/memory_mesh.js stats

# Standalone scrubber
./bin/scrubber.js scrub "raw content"
./bin/scrubber.js validate "content"
```

### Testing Integration
```bash
# Manual integration testing via Node REPL
node
> import { MemoryMesh } from './lib/memory/index.js'
> const mesh = new MemoryMesh()
> await mesh.add('test content', {tag: 'test'})
> await mesh.search('test')

# Test setup script
node bin/setup.js --force
```

## Architecture

### Layered Data Flow

Memory Mesh uses a **deterministic preprocessing pipeline** where content is scrubbed BEFORE embedding (opposite of typical RAG systems):

```
Raw Content
    ↓
Layer 0 Scrubber (6-stage pipeline)
  1. Structural Cleaning (HTML/MD strip, whitespace)
  2. Semantic Filtering (dedup, boilerplate removal)
  3. Normalization (headings, lists, punctuation)
  4. Chunking (semantic units, 10-500 tokens)
  5. Metadata Annotation (source, section, timestamps)
  6. Validation (quality checks)
    ↓
Embedding Factory (with fallback chain)
  Primary → Fallback1 → Fallback2 → Error
    ↓
LanceDB Vector Storage (Apache Arrow schema)
    ↓
./runtime/data/lancedb (disk storage)
```

### Core Components

**MemoryMesh** (`lib/memory/memory-mesh.js` - 911 lines)
- Central orchestrator with lazy initialization
- First `add()` or `search()` call triggers full init
- Automatic scrubbing on every `add()` operation
- Query caching: 5-minute TTL, 500-entry LRU cache
- Health checks: database connectivity, embedding service, latency monitoring

**Scrubber** (`lib/scrubber/scrubber.js`)
- Deterministic 6-stage pipeline (idempotent)
- Configuration in `lib/scrubber/config/defaults.js` has `enabled: false` by default
- MemoryMesh automatically enables it in constructor
- Token counting uses 4-char approximation (not GPT tokenizer) for speed
- Each stage has telemetry tracking (timing, success/failure)

**EmbeddingFactory** (`lib/embeddings/factory.js`)
- Multi-provider fallback chain with priority ordering
- Supports: Local ONNX, Ollama, OpenAI, Cohere
- Default: `Xenova/all-MiniLM-L6-v2` (384 dimensions, local ONNX)
- Per-service LRU caching (1000 entries) survives factory failures
- Lazy model loading - initializes only on first `embed()` call
- Vector dimension validation against schema at init time

**LanceDBClient** (`lib/lancedb/client.js`)
- Apache Arrow schema with dynamic vector dimensions (384/768/1536+)
- Connection pooling (single db connection reused)
- Exponential backoff retries (3 max, 1000ms initial delay)
- Default disk storage: `./runtime/data/lancedb`
- IVF-PQ index: 256 partitions, 8 sub-vectors, 20 nprobes
- Metadata stored as JSON strings (not structured fields) - requires `JSON.parse()` on retrieval

### Configuration System

**Hierarchy** (from `lib/lancedb/config.js`):
1. Environment variables (highest priority)
2. Defaults from DEFAULTS object
3. Type coercion and validation

**Critical environment variables:**
```bash
LANCEDB_URI='./runtime/data/lancedb'
LANCEDB_MEMORY_TABLE='memory_entries'
EMBEDDING_MODEL_TYPE='local'  # or 'openai', 'cohere', 'ollama'
EMBEDDING_MODEL_NAME='Xenova/all-MiniLM-L6-v2'
EMBEDDING_DIMENSION='384'
DEFAULT_TOP_K='10'
DEFAULT_SIMILARITY_THRESHOLD='0.7'
QUERY_CACHE_TTL='300'  # seconds
YAMO_DEBUG='true'      # Enable verbose logging
```

### Agent Integration Pattern

The system uses an **agent-discoverable CLI** pattern:

1. Agents (like `yamo-super`) read the source code of `tools/memory_mesh.js`
2. They parse the CLI interface to understand available operations
3. They execute commands by calling the script with arguments
4. The package handles the actual implementation

**Setup in new projects:**
```bash
npm install @yamo/memory-mesh
mkdir -p tools
cp node_modules/@yamo/memory-mesh/bin/memory_mesh.js tools/memory_mesh.js
```

The agent then reads `tools/memory_mesh.js` to discover the interface.

## Non-Obvious Design Decisions

### 1. Lazy Initialization
Constructor doesn't connect to DB or load models. First operation (`add()`, `search()`) triggers full init. This allows fast instantiation and deferred resource loading.

### 2. Scrubber-First Embedding
Content is deterministically sanitized BEFORE embedding (not after). This ensures semantic similarity is computed on clean, normalized text. Produces more consistent embeddings than embed-then-filter approaches.

### 3. Metadata as JSON Strings
LanceDB stores metadata as UTF8 JSON strings, not structured Arrow fields. This allows schema flexibility but requires `JSON.parse()` on every retrieval. Filters work only on top-level fields (`id`, `created_at`), not nested metadata properties.

### 4. Dual CLI Output Modes
CLI tools produce:
- JSON output for programmatic callers (STDIN/STDOUT)
- YAMO-formatted markdown blocks for skill integration

Controlled by detecting TTY and parsing context.

### 5. Vector Dimension Auto-Detection
System maps model names to known dimensions (in `lib/lancedb/schema.js`). At init, validates that configured dimension matches model's actual output dimension. Prevents dimension mismatches at runtime.

### 6. Graceful Embedding Fallback
If primary embedding service fails, system transparently tries fallbacks without throwing. Useful for local-first with cloud backup patterns. Only errors if all providers fail.

### 7. Query Result Caching
Separate caches for:
- **Embedding cache**: Per-service LRU (1000 entries, permanent)
- **Query cache**: Search results with 5-minute TTL (500 entries)

Assumes queries repeat within sessions but embeddings are reusable across sessions.

### 8. Silent-by-Default Logging
Many operations suppress console output to avoid corrupting REPL/spinner displays. Enable verbose logging with `YAMO_DEBUG=true`.

## Key Files

| Path | Purpose | Lines | Notes |
|------|---------|-------|-------|
| `lib/memory/memory-mesh.js` | Core orchestrator | 911 | Entry point for all operations |
| `lib/scrubber/scrubber.js` | 6-stage preprocessing | | Deterministic, idempotent |
| `lib/embeddings/factory.js` | Fallback embedding manager | | Priority-ordered provider chain |
| `lib/embeddings/service.js` | Multi-provider backend | | ONNX, Ollama, OpenAI, Cohere |
| `lib/lancedb/client.js` | Vector DB wrapper | | Retries, connection pooling |
| `lib/lancedb/schema.js` | Arrow schema + dimension map | | Dynamic vector dimensions |
| `lib/lancedb/config.js` | Config validation | 484 | Model name → dimension mapping |
| `lib/memory/memory-context-manager.js` | High-level agent API | | Auto-capture/recall patterns |
| `bin/memory_mesh.js` | CLI entry point | | JSON interface for agents |
| `index.d.ts` | Public TypeScript API | | Type definitions for consumers |

## Error Handling

Custom error classes in `lib/lancedb/errors.js`:
- `EmbeddingError` - Model load, embedding generation failures
- `StorageError` - DB connection, write failures
- `QueryError` - Search, retrieval failures
- `ConfigurationError` - Invalid config values

All errors sanitize sensitive data (API keys, tokens, env vars) before logging.

## Schema Evolution

**V1 Schema** (original):
- `id`, `vector`, `content`, `metadata`, `created_at`, `updated_at`

**V2 Schema** (current):
- Adds: `session_id`, `agent_id`, `memory_type`, `importance_score`, `access_count`, `last_accessed`
- Maintains backward compatibility with V1

The system detects schema version at runtime and handles both.
