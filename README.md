# MemoryMesh (Singularity Edition)

Portable, semantic memory system for AI agents with automatic Layer 0 sanitization and **Autonomous Kernel Integration**.

Built on the [YAMO Protocol](https://github.com/yamo-protocol) for transparent agent collaboration with structured workflows and immutable provenance.

## 🌌 Singularity Edition Highlights

- **Intelligent Installer**: Automatically detects OpenClaw workspaces and performs a full kernel upgrade.
- **YAMO Unified OS**: Natively includes the complete Macro (Specification) and Micro (Execution) workflow suite.
- **Ghost Protection**: Self-healing `AGENTS.md` injection to prevent narrative drift and maintain cognitive alignment.
- **Autonomous Bootstrap**: Deploys `BOOTSTRAP.yamo` as the primary agent entry point for protocol-native execution.
- **Surgical Deployment**: Intelligently skips global CLI clutter when working in project-specific modes.

## Features

- **Persistent Vector Storage**: Powered by LanceDB for semantic search.
- **LanceDB V2 Schema (Active)**: Top-level columns `memory_type`, `importance_score`, `access_count`, `last_accessed`, `session_id`, `agent_id` — populated on every write, queried server-side (WHERE clause) instead of full-table scans.
- **Layer 0 Scrubber**: Automatically sanitizes, deduplicates, and cleans content before embedding.
- **Local Embeddings**: Runs 100% locally using ONNX (no API keys required).
- **Portable CLI**: Simple flag-based interface for any agent or language (`tools/memory_mesh.mjs`).
- **YAMO Skills Integration**: Includes the Unified OS workflow system with automatic memory learning.
- **Pattern Recognition**: Workflows automatically store and retrieve execution patterns for optimization.
- **LLM-Powered Reflections**: Generate insights from memories using configurable LLM providers.
- **YAMO Audit Trail**: Automatic emission of structured blocks for all memory operations.

## Installation

```bash
npm install @yamo/memory-mesh
```

## Usage

### 🚀 Singularity Setup (OpenClaw)

To upgrade your workspace to full fidelity:

```bash
npx memory-mesh-setup
```

The installer will:
1.  Configure your `.env` substrate.
2.  Deploy the **BOOTSTRAP.yamo** kernel entry point.
3.  Inject **Ghost Protection** into `AGENTS.md`.
4.  Deploy **Native Kernel Modules** to `yamo-native-agent/`.

### CLI

The `memory-mesh` CLI provides seven commands for full subconscious CRUD and recall:

```bash
# Store a memory (automatically scrubbed & embedded)
memory-mesh store --content "My important memory" --type insight

# Store with full provenance metadata
memory-mesh store -c "Insight text" -t decision -r "Improves latency" -h "Caching reduces p95"

# Bulk-ingest a directory (recursive, by extension)
memory-mesh pull ./docs --extension ".md,.yamo" --type documentation

# Semantic search
memory-mesh search "query about orchestration" --limit 5

# Retrieve a specific record by ID
memory-mesh get --id mem_abc123

# Delete a record by ID
memory-mesh delete --id mem_abc123

# Synthesize insights from recent memories
memory-mesh reflect --topic "bugs" --lookback 10

# Database health and statistics
memory-mesh stats
```

**Command Reference:**

| Command | Key Options | Description |
|---------|-------------|-------------|
| `store` | `-c/--content` (required), `-t/--type`, `-r/--rationale`, `-h/--hypothesis` | Persist a semantic memory |
| `pull` | `<path>` (required), `-e/--extension`, `-t/--type` | Bulk-ingest a directory |
| `search` | `<query>` (required), `-l/--limit` | Semantic recall |
| `get` | `-i/--id` (required) | Fetch a record by ID |
| `delete` | `-i/--id` (required) | Remove a record by ID |
| `reflect` | `-t/--topic`, `-l/--lookback` | Synthesize insights from memories |
| `stats` | — | DB health, count, embedding model |

### Node.js API

```javascript
import { MemoryMesh } from '@yamo/memory-mesh';

const mesh = new MemoryMesh();
await mesh.add('Content', { meta: 'data' });
const results = await mesh.search('query');
```

### Enhanced Reflections with LLM

MemoryMesh supports LLM-powered reflection generation that synthesizes insights from stored memories:

```javascript
import { MemoryMesh } from '@yamo/memory-mesh';

// Enable LLM integration (requires API key or local model)
const mesh = new MemoryMesh({
  enableLLM: true,
  llmProvider: 'openai',  // or 'anthropic', 'ollama'
  llmApiKey: process.env.OPENAI_API_KEY,
  llmModel: 'gpt-4o-mini'
});

// Store some memories
await mesh.add('Bug: type mismatch in keyword search', { type: 'bug' });
await mesh.add('Bug: missing content field', { type: 'bug' });

// Generate reflection (automatically stores result to memory)
const reflection = await mesh.reflect({ topic: 'bugs', lookback: 10 });

console.log(reflection.reflection);
// Output: "Synthesized from 2 memories: Bug: type mismatch..., Bug: missing content..."

console.log(reflection.confidence);  // 0.85
console.log(reflection.yamoBlock);    // YAMO audit trail
```

**CLI Usage:**

```bash
# With LLM (default)
memory-mesh reflect '{"topic": "bugs", "limit": 10}'

# Without LLM (prompt-only for external LLM)
memory-mesh reflect '{"topic": "bugs", "llm": false}'
```

### YAMO Audit Trail

MemoryMesh automatically emits YAMO blocks for all operations when enabled:

```javascript
const mesh = new MemoryMesh({ enableYamo: true });

// All operations now emit YAMO blocks
await mesh.add('Memory content', { type: 'event' });      // emits 'retain' block
await mesh.search('query');                                 // emits 'recall' block
await mesh.reflect({ topic: 'test' });                      // emits 'reflect' block

// Query YAMO log
const yamoLog = await mesh.getYamoLog({ operationType: 'reflect', limit: 10 });
console.log(yamoLog);
// [{ id, agentId, operationType, yamoText, timestamp, ... }]
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
```

**Memory Integration Features:**
- **Workflow Orchestrator**: Searches for similar past workflows before starting
- **Design Phase**: Stores validated designs with metadata
- **Debug Phase**: Retrieves similar bug patterns and stores resolutions
- **Review Phase**: Stores code review outcomes and quality metrics
- **Complete Workflow**: Stores full execution pattern for future optimization

YAMO agents will automatically find tools in `tools/memory_mesh.js`.

## Docker

```bash
docker run -v $(pwd)/data:/app/runtime/data \
  yamo/memory-mesh store "Content"
```

## Integration with yamo-os

`@yamo/memory-mesh` is the memory subsystem used by [yamo-os](https://github.com/scgoetsch/yamo-os). The `YamoKernel` in yamo-os wraps it as `KernelBrain` and calls it on every `kernel.execute()` invocation:

- Every execution writes an interaction record to LanceDB via `brain.add()`
- `kernel.heartbeat()` triggers consolidation cycles that synthesise memories into skills
- The kernel injects `_kernel_execute` into MemoryMesh for recursive skill synthesis
- LanceDB path: `runtime/data/lancedb/` (configurable via `LANCEDB_URI` or `brain.path` in `yamo_config.json`)

When used standalone (without yamo-os), MemoryMesh operates as a pure semantic memory store — yamo-os integration is opt-in.

### Using with yamo-os

```typescript
import { YamoKernel } from "yamo-os";

const kernel = new YamoKernel({
  brain: {
    path: "./runtime/data/lancedb",
    enableMemory: true,
  },
});
await kernel.boot();
// MemoryMesh is now available as kernel.brain
const results = await kernel.brain.search("previous interactions");
```

For full deployment including the bridge coordination plane, see [yamo-infra](https://github.com/scgoetsch/yamo-infra).

## About YAMO Protocol

Memory Mesh is built on the **YAMO (Yet Another Model Ontology) Protocol** - a structured language for transparent AI agent collaboration with immutable provenance tracking.

**YAMO Protocol Features:**
- **Structured Agent Workflows**: Semicolon-terminated constraints, explicit handoff chains
- **Meta-Reasoning Traces**: Hypothesis, rationale, confidence, and observation annotations
- **Blockchain Integration**: Immutable audit trails via Model Context Protocol (MCP)
- **Multi-Agent Coordination**: Designed for transparent collaboration across organizational boundaries

**Learn More:**
- **YAMO Protocol Organization**: [github.com/yamo-protocol](https://github.com/yamo-protocol)
- **Protocol Specification**: See the YAMO RFC documents for core syntax and semantics
- **Ecosystem**: Explore other YAMO-compliant tools and skills

Memory Mesh implements YAMO v2.1.0 compliance with:
- MemorySystemInitializer agent for graceful degradation
- Context passing between agents (`from_AgentName.output`)
- Structured logging with meta-reasoning
- Priority levels and constraint-based execution
- Automatic workflow pattern storage for continuous learning

**Related YAMO Projects:**
- [yamo-chain](https://github.com/yamo-protocol/yamo-protocol) - Blockchain integration for agent provenance

## Documentation

- **Architecture Guide**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Comprehensive system architecture
- **User Guide**: [docs/USER_GUIDE.md](docs/USER_GUIDE.md) - Operator and integration guide
- **Development Guide**: [CLAUDE.md](CLAUDE.md) - Guide for Claude Code development
- **V2 Column Changelog**: [docs/CHANGELOG-v3.2.3.md](docs/CHANGELOG-v3.2.3.md) - V2 schema migration notes
- **Marketplace**: [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) - Plugin metadata

## Configuration

### LLM Provider Configuration

```bash
# Required for LLM-powered reflections
LLM_PROVIDER=openai          # Provider: 'openai', 'anthropic', 'ollama'
LLM_API_KEY=sk-...            # API key for OpenAI/Anthropic
LLM_MODEL=gpt-4o-mini         # Model name
LLM_BASE_URL=https://...      # Optional: Custom API base URL
```

**Supported Providers:**
- **OpenAI**: GPT-4, GPT-4o-mini, etc.
- **Anthropic**: Claude 3.5 Haiku, Sonnet, Opus
- **Ollama**: Local models (llama3.2, mistral, etc.)

### YAMO Configuration

```bash
# Optional YAMO settings
ENABLE_YAMO=true              # Enable YAMO block emission (default: true)
YAMO_DEBUG=true               # Enable verbose YAMO logging
```

### LanceDB Configuration

```bash
# Vector database settings
LANCEDB_URI=./runtime/data/lancedb
LANCEDB_MEMORY_TABLE=memory_entries
```

### Embedding Configuration

```bash
# Embedding model settings
EMBEDDING_MODEL_TYPE=local    # 'local', 'ollama', 'openai', 'cohere'

# Recommended: Gemma-300m for v3.0 Singularity Fidelity (matches OpenClaw)
EMBEDDING_MODEL_NAME=hf_ggml-org_embeddinggemma-300m-qat-Q8_0.gguf
EMBEDDING_DIMENSION=384

# Lightweight Default (fallback)
# EMBEDDING_MODEL_NAME=Xenova/all-MiniLM-L6-v2
# EMBEDDING_DIMENSION=384
```

### Example .env File

```bash
# LLM for reflections
LLM_PROVIDER=openai
LLM_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o-mini

# YAMO audit
ENABLE_YAMO=true
YAMO_DEBUG=false

# Vector DB
LANCEDB_URI=./data/lancedb

# Embeddings (local default)
EMBEDDING_MODEL_TYPE=local
EMBEDDING_MODEL_NAME=hf_ggml-org_embeddinggemma-300m-qat-Q8_0.gguf
```


