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

# With type, rationale, and document context (Situated Context)
memory-mesh store \
  --content "Always use fire-and-forget for V2 column populate to avoid blocking writes" \
  --type "insight" \
  --rationale "Prevents latency regression on add()" \
  --document-context "LanceDB schema and integration guidelines"

# As a decision with Decision Context Graph edges (comma-separated memory IDs).
# See section 6 for the relation vocabulary.
memory-mesh store \
  --content "Enable WAL journal mode" \
  --type "decision" \
  --rationale "concurrent reads during writes" \
  --depends-on "mem_abc,mem_def" \
  --justified-by "mem_ghi"
```

### Search by meaning

```bash
# Basic semantic search (defaults to hybrid mode)
memory-mesh search "LanceDB column population" --limit 5

# Vector-only search mode
memory-mesh search "LanceDB column population" --limit 5 --mode vector

# Keyword-only (FTS / TF-IDF) search mode
memory-mesh search "LanceDB column population" --limit 5 --mode keyword

# Search with server-side SQL filter (WHERE clause on V2 columns)
memory-mesh search "consolidation results" --limit 3 --filter "importance_score > 0.6"
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

### Curated recall & lifecycle

```bash
# Pinned memories verbatim + newly-due deferrals + contextual matches (bd prime analog)
memory-mesh prime "current task context" --limit 5

# Pin / unpin (by id or stable metadata.key) so prime always surfaces it
memory-mesh pin mem_abc123
memory-mesh unpin mem_abc123

# Lifecycle state: active | superseded | deprecated | archived
memory-mesh set-state mem_abc123 deprecated

# Suppress from recall until a date, then resurface (bd defer analog)
memory-mesh defer mem_abc123 2026-09-01
memory-mesh defer mem_abc123 --clear
```

### Belief hygiene

```bash
# Memories still resting on refuted decisions (exits nonzero if any)
memory-mesh stale-beliefs

# Decision edges whose endpoints no longer resolve (exits nonzero if any)
memory-mesh orphans

# Active memories untouched for N days (bd stale analog)
memory-mesh stale --days 90
```

### History & portability

```bash
# Append-only revision history for a memory or skill id
memory-mesh history mem_abc123

# Restore a deleted memory from its revision snapshot
memory-mesh restore mem_abc123

# Deterministic, vector-free JSONL export (git-committable) and idempotent re-import
memory-mesh export backup.jsonl
memory-mesh import backup.jsonl
```

### Health checks

```bash
# Mechanical checks: dangling edges, vector index, superseded-state drift,
# skill metadata. Exits nonzero on failure — safe for CI/cron.
memory-mesh doctor
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

### Search Options & Hybrid Search

The `search` method supports vector similarity search, keyword search (native LanceDB FTS / TF-IDF), and hybrid combination (RRF merge):

```javascript
// Hybrid search (default): combines vector similarity and native FTS keyword search
const results = await mesh.search('authentication fix', {
  limit: 5,
  mode: 'hybrid'
});

// Vector-only search mode
const vectorOnly = await mesh.search('authentication fix', {
  limit: 5,
  mode: 'vector'
});

// Keyword-only search mode
const keywordOnly = await mesh.search('authentication fix', {
  limit: 5,
  mode: 'keyword'
});
```

### Situated Context / Contextual Retrieval

When saving content, you can provide explicit document/source context to preserve semantic meaning across fragmented chunks:

```javascript
// Provide explicit document context during ingestion
await mesh.add('The database handle must be refreshed during IO error retries.', {
  type: 'insight',
  documentContext: 'LanceDB integration hardening and reliability guidelines'
});

// If no documentContext is provided, it is automatically derived from
// metadata.title, metadata.source, or parsed from the first heading (# Title)
```

### Filtered search (V2 — recommended)

```javascript
// Server-side SQL filter on top-level V2 columns
// Avoids loading the full table into memory
const codeResults = await mesh.search('authentication fix', {
  limit: 5,
  filter: "memory_type = 'retain'",
});

// Exclude consolidation records using SQL comparison operators
const rawResults = await mesh.search('debug patterns', {
  limit: 10,
  filter: "memory_type IS NULL OR memory_type != 'consolidation'",
});
```

The `filter` string is forwarded directly to LanceDB's WHERE clause on the search query. It supports standard SQL comparison operators on top-level V2 columns. Graph-RAG neighborhood boosting (1-hop 1.15x boost, 2-hop 1.07x boost) is automatically applied to all search modes.

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

## 6. Decision Context Graph

Decisions can be recorded as a traversable lineage in a dedicated `decision_edges`
table — separate from the Graph-RAG boost graph so the retrieval signal stays
clean. Nodes are memory IDs; `relation` is a controlled vocabulary. Edge direction
is invariant: `source_id` is always the newer memory, `target_id` always pre-exists.

| Relation | Meaning | Written from |
|---|---|---|
| `supersedes` | the new decision replaces the target | belief revision (`metadata.replaces_memory_id` or `metadata.key`) — automatic |
| `depends-on` | the new decision rests on a still-active target | `metadata.depends_on` |
| `justified-by` | the new decision is grounded in the target evidence | `metadata.justified_by` |
| `contradicts` | the new decision conflicts with a retained target | `metadata.contradicts` |

The three metadata fields accept a string or a string array. Edges are written
fire-and-forget and only for *decision* writes (a memory of `type: 'decision'`,
or any write that supersedes something or carries an edge field), so ordinary
`add()` calls do no edge work. Duplicate `(target, relation)` pairs within a
single write are collapsed, and self-edges are skipped.

### Creating edges

```javascript
const base = await mesh.add('Use Postgres as the primary store', { type: 'decision' });

const wal = await mesh.add('Enable WAL journal mode', {
  type: 'decision',
  reasoning: 'concurrent reads during writes',  // stored as the edge rationale
  hypothesis_confidence: 0.8,                    // stored as the edge weight (default 1.0)
  depends_on: [base.id],
});
```

### Traversing lineage

`decisionLineage()` is a BFS over `decision_edges` (not the RAG boost traversal):

```javascript
// ancestors: what this decision supersedes / depends on / is justified by
await mesh.decisionLineage(wal.id, { direction: 'ancestors' });

// dependents: "base was reversed — what still-active decisions rested on it?"
await mesh.decisionLineage(base.id, { direction: 'dependents' });

// filter by relation and cap depth
await mesh.decisionLineage(base.id, {
  direction: 'dependents',
  relations: ['supersedes', 'depends-on'],
  maxHops: 3,   // default 3
});
// → [{ from, to, relation, rationale, weight, hop }, ...]
```

### Closing the outcome loop

`recordOutcome()` stores the observed result on the decision's metadata and
resets `importance_score` by status, so retrieval ranking reflects whether the
decision actually worked — not merely how often it was read:

```javascript
await mesh.recordOutcome(base.id, { status: 'refuted', note: 'switched to local-first' });
// status → importance_score:  validated 0.9 | mixed 0.5 | refuted 0.2
```

---

## 7. Backfilling Existing Records

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

## 8. YAMO Audit Trail

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

## 9. Configuration

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
LLM_PROVIDER=openai                  # openai | anthropic | ollama | zai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# Retrieval tuning — hybrid RRF channel weights. Keyword is down-weighted by
# default (paired eval: equal weights cost MRR on paraphrase queries; 0.4
# keeps the exact-identifier rescue). Finite and > 0, else the default wins.
HYBRID_VECTOR_WEIGHT=1.0
HYBRID_KEYWORD_WEIGHT=0.4

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

## 10. Maintenance

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

## 11. Troubleshooting

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
