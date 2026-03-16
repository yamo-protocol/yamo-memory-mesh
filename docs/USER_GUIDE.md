# MemoryMesh User Guide

**Version:** 3.2.6
**Date:** 2026-03-16

---

## 1. Introduction

MemoryMesh is a portable semantic memory layer for AI agents. It stores content as vector embeddings in a local LanceDB database and retrieves it by semantic meaning rather than exact keyword match. All storage is local-first — no cloud service required for default operation.

This guide covers installation, day-to-day CLI use, Node.js integration, the V2 schema columns, and operational maintenance.

---

## 2. Installation

```bash
npm install @yamo/memory-mesh
```

Run the optional setup script to deploy YAMO skills and CLI tools:

```bash
npx memory-mesh-setup
```

The setup script:
- Copies YAMO skills (`yamo-super`, `scrubber`) to `~/.claude/skills/memory-mesh/`
- Copies the CLI adapter to `./tools/memory_mesh.js`
- Prompts before overwriting existing files

---

## 3. CLI Quick Reference

All operations go through the `memory-mesh` command (or `./tools/memory_mesh.js` in project mode).

### Store a memory

```bash
# Minimal
memory-mesh store --content "LanceDB V2 adds memory_type and importance_score columns"

# With type and rationale
memory-mesh store \
  --content "Always use fire-and-forget for V2 column populate to avoid blocking writes" \
  --type "insight" \
  --rationale "Prevents latency regression on add()"
```

### Search by meaning

```bash
# Basic semantic search
memory-mesh search "LanceDB column population" --limit 5

# With type filter (uses server-side WHERE on memory_type when available)
memory-mesh search "consolidation results" --limit 3
```

### Retrieve by ID

```bash
memory-mesh get --id mem_abc123
```

### Delete a record

```bash
memory-mesh delete --id mem_abc123
```

### Bulk ingest a directory

```bash
memory-mesh pull ./docs --extension ".md,.yamo" --type documentation
```

### Synthesize a reflection from recent memories

```bash
# Requires LLM provider configured (see Configuration section)
memory-mesh reflect --topic "performance improvements" --lookback 10
```

### Database stats

```bash
memory-mesh stats
```

Example output:
```
MemoryMesh Stats
  Total records : 1,243
  DB path       : ./runtime/data/lancedb
  Embedding     : Xenova/all-MiniLM-L6-v2 (384d)
  V2 schema     : active (memory_type column present)
  Null memory_type : 47 (backfill pending)
```

---

## 4. Node.js API

### Basic usage

```javascript
import { MemoryMesh } from '@yamo/memory-mesh';

const mesh = new MemoryMesh();
await mesh.init();

// Store
await mesh.add('User prefers dark mode', { type: 'preference' });

// Search
const results = await mesh.search('user interface preferences', { limit: 5 });
console.log(results[0].content);  // "User prefers dark mode"

// Get by ID
const record = await mesh.get('mem_abc123');

// Delete
await mesh.delete('mem_abc123');

// Stats
const stats = await mesh.stats();
```

### With LLM (reflections)

```javascript
const mesh = new MemoryMesh({
  enableLLM: true,
  llmProvider: 'openai',
  llmApiKey: process.env.OPENAI_API_KEY,
  llmModel: 'gpt-4o-mini',
});

await mesh.init();

// Reflect on recent memories about bugs
const reflection = await mesh.reflect({ topic: 'bugs', lookback: 10 });
console.log(reflection.reflection);
console.log(reflection.confidence);  // 0.0–1.0
```

### Filtered search (V2 — recommended)

```javascript
// Server-side filter on memory_type column
// Avoids loading the full table into memory
const codeResults = await mesh.search('authentication fix', {
  limit: 5,
  filter: "memory_type = 'retain'",
});

// Exclude consolidation records
const rawResults = await mesh.search('debug patterns', {
  limit: 10,
  filter: "memory_type IS NULL OR memory_type != 'consolidation'",
});
```

The `filter` string is forwarded directly to LanceDB's WHERE clause on the vector search query. It supports standard SQL comparison operators on top-level V2 columns.

### `getAll` with limit

```javascript
// Retrieve up to 500 recent records (legacy approach — prefer search with filter)
const records = await mesh.getAll({ limit: 500 });
```

---

## 5. LanceDB V2 Schema

### Column Reference

Every record in `memory_entries` has six V2 top-level columns in addition to the V1 fields:

| Column | Type | Purpose | Default on insert |
|---|---|---|---|
| `memory_type` | `string?` | Semantic category of the memory | Derived from `metadata.type` |
| `importance_score` | `float?` | Priority weight 0.0–1.0 | Derived from type (see table below) |
| `access_count` | `int?` | How many times this record has been retrieved | `0` |
| `last_accessed` | `timestamp?` | Timestamp of last retrieval | Set on first write |
| `session_id` | `string?` | Session association (future use) | `null` unless passed in metadata |
| `agent_id` | `string?` | Agent/skill that created the record (future use) | `null` unless passed in metadata |

### Importance Scores by Type

| `memory_type` | `importance_score` | Notes |
|---|---|---|
| `consolidation` | 0.9 | Synthesized summaries — highest priority |
| `retain` | 0.7 | Standard kernel execution records |
| `reflect` | 0.6 | Insight and reflection blocks |
| `recall` | 0.5 | Skill interception events |
| `kernel_op` | 0.3 | Low-level audit records |
| *(unknown)* | 0.5 | Default for custom or unrecognized types |

### Querying V2 Columns

Since V2 columns are top-level LanceDB fields (not buried in the JSON `metadata` string), they support efficient server-side filtering without loading row content:

```javascript
// Only works on top-level V2 fields
filter: "importance_score > 0.6"
filter: "memory_type = 'consolidation'"
filter: "access_count > 10"
filter: "memory_type IS NULL"   // records not yet backfilled
```

Filtering on nested metadata fields (e.g., `metadata.source = 'kernel'`) requires client-side post-processing after retrieval — V2 columns were added specifically to avoid this pattern for the most common queries.

### Backward Compatibility

- V1 records (NULL V2 columns) are read without error on all queries.
- Server-side filtered methods automatically fall back to the legacy `getAll()` scan when `memory_type IS NULL` results are zero (pre-backfill tables).
- No data migration is required. Backfill runs in the background automatically.

---

## 6. Backfilling Existing Records

Records stored before V2 column activation have `memory_type IS NULL`. They are backfilled gradually:

- Backfill reads `WHERE memory_type IS NULL`, derives `memory_type` and `importance_score` from the stored `metadata` JSON, and writes them back.
- In YAMO-OS, backfill runs every 5 consolidation cycles (fire-and-forget, 50 records per batch).
- You can call `backfillV2Columns` directly from a `KernelBrain` instance if you need to run it on demand.

To check how many records still need backfill:

```bash
memory-mesh stats
# Look for: "Null memory_type: N (backfill pending)"
```

---

## 7. YAMO Audit Trail

When `enableYamo: true` (default), every operation emits a structured YAMO block to the `yamo_blocks` table:

| Operation | Block type |
|---|---|
| `add()` | `retain` |
| `search()` | `recall` |
| `reflect()` | `reflect` |

Query the YAMO log:

```javascript
const log = await mesh.getYamoLog({ operationType: 'reflect', limit: 10 });
// [{ id, agentId, operationType, yamoText, timestamp, ... }]
```

---

## 8. Configuration

### Environment Variables

```bash
# Vector database
LANCEDB_URI=./runtime/data/lancedb
LANCEDB_MEMORY_TABLE=memory_entries

# Embedding model
EMBEDDING_MODEL_TYPE=local           # local | ollama | openai | cohere
EMBEDDING_MODEL_NAME=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384

# LLM (for reflect() only)
LLM_PROVIDER=openai                  # openai | anthropic | ollama
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# YAMO
ENABLE_YAMO=true
YAMO_DEBUG=false
```

### Constructor Options

```javascript
const mesh = new MemoryMesh({
  // Storage
  dbDir: './custom/path/lancedb',      // overrides LANCEDB_URI

  // Embedding
  // Set via env vars — not constructor options

  // LLM
  enableLLM: true,
  llmProvider: 'openai',
  llmApiKey: process.env.OPENAI_API_KEY,
  llmModel: 'gpt-4o-mini',

  // Behavior
  enableYamo: true,                    // emit YAMO audit blocks
  enableMemory: true,                  // enable storage (false = no-op add/search)
  agentId: 'my-custom-agent',          // written to agent_id V2 column when set
});
```

---

## 9. Maintenance

### Compact the database

Run periodically to merge Delta files and reclaim disk space:

```javascript
// Via KernelBrain (yamo-os integration)
await brain.optimize();

// Via MemoryMesh directly (if exposed)
await (mesh as any).optimize?.();
```

In YAMO-OS, `optimize()` is called automatically every 10 consolidation cycles.

### Clear and reindex

If the vector index becomes stale or corrupted:

```bash
# Remove the LanceDB directory (destructive — all memories lost)
rm -rf runtime/data/lancedb

# Or just clear the skills index (safe)
npx tsx bin/yamo.ts clear-skills
```

### Prune low-reliability skills

```javascript
await mesh.pruneSkills(0.4);  // remove skills below 40% reliability
```

---

## 10. Troubleshooting

**`search()` returns no results**

- Verify `memory-mesh stats` shows a non-zero record count.
- Check `EMBEDDING_DIMENSION` matches the model output. Mismatched dimensions cause silent failures.
- Try a broader query — semantic search requires conceptual overlap, not keyword match.

**V2 columns are NULL after storing a record**

- V2 column population is fire-and-forget. It runs asynchronously after `add()` returns.
- Wait a moment then re-fetch — or check the backfill status with `memory-mesh stats`.
- If `client.table` is unavailable (old MemoryMesh build or test environment), V2 populate is silently skipped.

**`filter` option ignored in search results**

- Filters only work on top-level V2 columns (`memory_type`, `importance_score`, `access_count`, `last_accessed`).
- Nested metadata fields like `metadata.source` are not filterable server-side.
- Ensure the records you are filtering have non-NULL values in the target column (run backfill first if needed).

**LLM reflection fails**

- Confirm `enableLLM: true` and a valid `llmProvider` / `llmApiKey` are set.
- Ollama: ensure the model is pulled (`ollama pull llama3.2`) and the service is running.
- The reflection still completes without LLM — it generates a template summary instead.

**`memory-mesh: command not found`**

```bash
# Add node_modules/.bin to PATH, or use npx
npx memory-mesh search "query"

# Or reference the installed binary directly
./node_modules/.bin/memory-mesh search "query"
```
