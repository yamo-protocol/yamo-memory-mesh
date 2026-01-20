# Release Notes v2.3.2 - LLM-Powered Reflections with YAMO Audit Trail

**Release Date**: 2026-01-20
**Version**: 2.3.2
**Commit**: 96e86b5

---

## Overview

This release introduces **LLM-powered reflection generation** and **YAMO protocol audit trail** capabilities to MemoryMesh. The system can now synthesize insights from stored memories using configurable LLM providers while maintaining complete provenance through structured YAMO block emission.

---

## Major Features

### 1. Multi-Provider LLM Integration

**New Module**: `lib/llm/client.js` (392 lines)

Unified LLM client supporting three providers with automatic fallback:

| Provider | Use Case | Cost | Latency |
|----------|----------|------|---------|
| OpenAI | Production, highest quality | $$$ | Low |
| Anthropic | Production, great for reasoning | $$$ | Low |
| Ollama | Local, private, free | Free | Medium |

**Configuration:**
```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1  # Optional custom endpoint
```

**Key Features:**
- Exponential backoff retry logic (max 2 retries)
- 30-second request timeout
- Graceful fallback to aggregation on failure
- Request/response statistics tracking
- Validates response structure (reflection + confidence)

**Example Usage:**
```javascript
const mesh = new MemoryMesh({
  enableLLM: true,
  llmProvider: 'openai',
  llmApiKey: process.env.LLM_API_KEY,
  llmModel: 'gpt-4o-mini'
});

const reflection = await mesh.reflect({
  topic: 'bugs',
  lookback: 10
});

console.log(reflection.reflection);  // Synthesized insight
console.log(reflection.confidence);  // 0.85
console.log(reflection.yamoBlock);   // Audit trail
```

---

### 2. Enhanced Reflect Functionality

**Modified Module**: `lib/memory/memory-mesh.js` (+220 lines)

**New Features:**
- **LLM-powered insight synthesis** from retrieved memories
- **Automatic reflection storage** to memory with metadata
- **Configurable lookback window** for memory retrieval
- **Prompt-only mode** for external LLM integration
- **Graceful degradation** when LLM unavailable

**API:**
```javascript
async reflect(options = {}) {
  // Options
  topic?: string;        // Search topic (default: 'general')
  lookback?: number;     // Max memories to retrieve (default: 50)
  limit?: number;        // Alias for lookback
  generate?: boolean;    // Call LLM or return prompt only (default: true)

  // Returns
  {
    id: string;              // 'reflect_timestamp_random'
    reflection: string;      // Generated insight or aggregated text
    confidence: number;      // 0.0 to 1.0
    topic: string;           // The topic used
    sourceMemoryCount: number;
    prompt: string;          // The prompt sent to LLM
    context: Array;          // Retrieved memories
    yamoBlock: string;       // YAMO audit block (if enabled)
    createdAt: Date;
  }
}
```

**CLI Usage:**
```bash
# With LLM generation
memory-mesh reflect '{"topic": "bugs", "lookback": 10}'

# Prompt-only (for external LLM)
memory-mesh reflect '{"topic": "bugs", "generate": false}'
```

---

### 3. YAMO Protocol Audit Trail

**New Modules:**
- `lib/yamo/emitter.js` (180 lines) - YAMO block builder
- `lib/yamo/schema.js` (140 lines) - Blockchain-ready storage schema

**What is YAMO?**
YAMO (Yet Another Markup for Orchestration) is a structured language for transparent AI agent collaboration with immutable provenance tracking.

**YAMO Block Format:**
```yaml
agent: MemoryMesh_agentId;
intent: synthesize_insights_from_context;
context:
  topic;bugs;
  memory_count;5;
output:
  reflection;Synthesized insight...;
  confidence;0.85;
meta:
  hypothesis;
  rationale;
  observation;
```

**Operation Types:**
| Type | Triggered By | Description |
|------|--------------|-------------|
| `retain` | `mesh.add()` | Memory storage events |
| `recall` | `mesh.search()` | Memory retrieval events |
| `reflect` | `mesh.reflect()` | Reflection generation events |

**Configuration:**
```javascript
const mesh = new MemoryMesh({
  enableYamo: true,    // Enable YAMO emission (default: true)
  agentId: 'my-agent'  // Agent identifier for blocks
});
```

**API:**
```javascript
// Get YAMO audit log
const yamoLog = await mesh.getYamoLog({
  operationType: 'reflect',  // Filter by type
  limit: 10                  // Max entries
});

// Returns: [{ id, agentId, operationType, yamoText, timestamp, ... }]
```

**Schema:**
```javascript
{
  id: string;              // Unique block ID
  agent_id: string;        // Agent identifier
  operation_type: string;  // 'retain', 'recall', 'reflect'
  yamo_text: string;       // Full YAMO block
  timestamp: Date;         // ISO timestamp
  block_hash: string;      // Future: blockchain hash
  prev_hash: string;       // Future: previous block hash
  metadata: string;        // JSON metadata
}
```

---

## Breaking Changes

**None** - All features are backward compatible via feature flags.

**Default Behavior:**
- `enableLLM: true` - LLM features enabled by default
- `enableYamo: true` - YAMO emission enabled by default

**Disable Features:**
```javascript
const mesh = new MemoryMesh({
  enableLLM: false,  // Disable LLM integration
  enableYamo: false  // Disable YAMO audit
});
```

---

## New Files

### Source Code
```
lib/llm/
  ├── client.js          # Multi-provider LLM client (392 lines)
  └── index.js           # Module exports

lib/yamo/
  ├── emitter.js         # YAMO block builder (180 lines)
  ├── schema.js          # Arrow schema for YAMO table (140 lines)
  └── index.js           # Module exports
```

### Tests
```
test/reflection.test.js   # LLM and YAMO tests (182 lines)
```

### Documentation
```
docs/LLM_SETUP.md         # Complete LLM setup guide (272 lines)
docs/plans/
  └── 2026-01-19-enhance-reflect-functionality.md  # Implementation plan
.env.example              # Environment variable template
```

---

## Modified Files

### lib/memory/memory-mesh.js
**Changes:** +220 lines
- Added `enableLLM`, `enableYamo`, `agentId` options
- Integrated `LLMClient` for reflection generation
- Added YAMO emission hooks to `add()`, `search()`, `reflect()`
- Added `getYamoLog()` API for audit trail retrieval
- Added `_emitYamoBlock()` helper with fire-and-forget pattern

**Key Methods:**
```javascript
// New/Modified
constructor(options = {})      // Added LLM and YAMO options
async reflect(options = {})    // Enhanced with LLM generation
async add(content, metadata)   // Added YAMO retain hook
async search(query, options)   // Added YAMO recall hook
async getYamoLog(options)      // New: audit log retrieval
```

### lib/search/keyword-search.js
**Changes:** Bug fix for type handling
- Fixed metadata type checking

### README.md
**Changes:** +100 lines
- Added LLM integration section with examples
- Added YAMO audit trail documentation
- Added configuration section with all env vars
- Added quick setup examples

### package.json
**Changes:** Version bump 2.1.3 → 2.3.2

---

## Test Coverage

### test/reflection.test.js (9 tests, all passing)

| Test | Description |
|------|-------------|
| Prompt-only mode | Returns prompt when LLM disabled |
| Fallback on LLM fail | Graceful degradation when API fails |
| YAMO block emission | Verifies YAMO blocks are generated |
| Lookback parameter | Limits memory retrieval correctly |
| Reflection metadata | Stores reflection with proper ID format |
| YAMO log retrieval | Returns audit log as array |
| YAMO log filtering | Filters by operation type |
| Topic-based search | Searches memories by topic |
| Empty database | Handles no results gracefully |

**Run Tests:**
```bash
npm test
# or
node --test test/reflection.test.js
```

**Type Check:**
```bash
npm run type-check
# All TypeScript checks passing
```

---

## Configuration Guide

### Complete .env File

```bash
# ==========================================
# LLM Provider Configuration
# ==========================================
LLM_PROVIDER=openai              # 'openai', 'anthropic', 'ollama'
LLM_API_KEY=sk-your-key-here     # API key (not needed for Ollama)
LLM_MODEL=gpt-4o-mini            # Model name
# LLM_BASE_URL=https://...        # Optional: custom endpoint

# ==========================================
# YAMO Protocol Configuration
# ==========================================
ENABLE_YAMO=true                 # Enable YAMO emission (default: true)
YAMO_DEBUG=false                 # Verbose YAMO logging (default: false)

# ==========================================
# LanceDB Configuration
# ==========================================
LANCEDB_URI=./runtime/data/lancedb
LANCEDB_MEMORY_TABLE=memory_entries
# LANCEDB_YAMO_TABLE=yamo_log

# ==========================================
# Embedding Configuration
# ==========================================
EMBEDDING_MODEL_TYPE=local
EMBEDDING_MODEL_NAME=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

### LLM Provider Quick Setup

**OpenAI (Fastest):**
```bash
export LLM_PROVIDER=openai LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini
```

**Anthropic:**
```bash
export LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... LLM_MODEL=claude-3-5-haiku-20241022
```

**Ollama (Free/Local):**
```bash
ollama pull llama3.2 && ollama serve &
export LLM_PROVIDER=ollama LLM_MODEL=llama3.2
```

---

## API Reference

### MemoryMesh Constructor

```javascript
new MemoryMesh({
  // LLM Configuration
  enableLLM: true,              // Enable LLM features (default: true)
  llmProvider: 'openai',        // Provider: 'openai', 'anthropic', 'ollama'
  llmApiKey: 'sk-...',          // API key (defaults to LLM_API_KEY env)
  llmModel: 'gpt-4o-mini',      // Model name (defaults to LLM_MODEL env)

  // YAMO Configuration
  enableYamo: true,             // Enable YAMO audit (default: true)
  agentId: 'my-agent',          // Agent identifier (default: 'default')

  // Existing options...
  dbPath: './runtime/data/lancedb',
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  // ...
})
```

### reflect() Method

```javascript
const result = await mesh.reflect({
  topic: 'bugs',          // Search topic (default: 'general')
  lookback: 10,           // Max memories to include (default: 50)
  limit: 10,              // Alias for lookback
  generate: true          // Call LLM (default: true)
});

// Result structure
{
  id: 'reflect_1737358900_abc123',
  reflection: 'Synthesized insight from memories...',
  confidence: 0.85,
  topic: 'bugs',
  sourceMemoryCount: 5,
  prompt: 'Full prompt sent to LLM...',
  context: [...],         // Retrieved memories
  yamoBlock: 'agent: ...', // YAMO audit block
  createdAt: Date
}
```

### getYamoLog() Method

```javascript
const log = await mesh.getYamoLog({
  operationType: 'reflect',  // 'retain', 'recall', 'reflect', or undefined for all
  limit: 10,                 // Max entries (default: 50)
  agentId: 'my-agent'        // Filter by agent (optional)
});

// Returns array of YAMO entries
[{
  id: 'yamo_1737358900_xyz',
  agentId: 'my-agent',
  operationType: 'reflect',
  yamoText: 'agent: MemoryMesh...',
  timestamp: Date,
  metadata: {...}
}, ...]
```

### LLMClient Direct Usage

```javascript
import { LLMClient } from '@yamo/memory-mesh/lib/llm/index.js';

const client = new LLMClient({
  provider: 'openai',
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',  // Optional custom URL
  timeout: 30000,        // Request timeout (ms)
  maxRetries: 2          // Retry attempts
});

// Generate reflection
const result = await client.reflect(prompt, memories);
// { reflection: string, confidence: number }

// Get statistics
const stats = client.getStats();
// { totalRequests, successfulRequests, failedRequests, fallbackCount, successRate }

// Reset stats
client.resetStats();
```

### YamoEmitter Usage

```javascript
import { YamoEmitter } from '@yamo/memory-mesh/lib/yamo/index.js';

// Build YAMO blocks
const reflectBlock = YamoEmitter.buildReflectBlock({
  agentId: 'my-agent',
  topic: 'bugs',
  memoryCount: 5,
  reflection: 'Insight...',
  confidence: 0.85
});

const retainBlock = YamoEmitter.buildRetainBlock({
  agentId: 'my-agent',
  memoryId: 'mem_123',
  content: 'Memory content',
  metadata: { type: 'bug' }
});

const recallBlock = YamoEmitter.buildRecallBlock({
  agentId: 'my-agent',
  query: 'search query',
  resultCount: 3,
  topResults: [...]
});
```

---

## Troubleshooting

### Issue: "LLM API key not configured"

**Solution:** Set `LLM_API_KEY` environment variable or pass `llmApiKey` option.

```bash
echo $LLM_API_KEY  # Should show your key
```

### Issue: "Unexpected end of JSON input"

**Cause:** Custom API endpoint has non-standard response format.

**Solution:** Ensure `LLM_BASE_URL` points to the base URL only, not the full endpoint path.

```bash
# Wrong
LLM_BASE_URL=https://api.example.com/v1/chat/completions

# Correct
LLM_BASE_URL=https://api.example.com/v1
```

### Issue: Ollama connection refused

**Solution:** Ensure Ollama server is running.

```bash
# Check if running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### Issue: Timeout errors

**Solution:** Increase timeout or use local Ollama.

```javascript
const mesh = new MemoryMesh({
  llmProvider: 'ollama',  // No timeout for local
  // Or increase timeout
  llmTimeout: 60000       // 60 seconds
});
```

---

## Cost Estimates

### OpenAI gpt-4o-mini
| Operations | Cost |
|------------|------|
| 1,000 reflections | ~$0.10 |
| 10,000 reflections | ~$1.00 |

### Anthropic claude-3-5-haiku
| Operations | Cost |
|------------|------|
| 1,000 reflections | ~$0.15 |
| 10,000 reflections | ~$1.50 |

### Ollama
| Operations | Cost |
|------------|------|
| Unlimited | **Free** (compute cost only) |

---

## Security Best Practices

1. **Never commit API keys** to version control
2. **Use `.env` files** (added to `.gitignore`)
3. **Rotate keys regularly**
4. **Set usage limits** in provider console
5. **Monitor usage** with `client.getStats()`

```bash
# Add to .gitignore
.env
.env.local
*.env
```

---

## Migration Guide

### From v2.1.x to v2.3.2

**No breaking changes** - existing code works without modification.

**To enable new features:**

1. **Add .env file:**
```bash
cp .env.example .env
# Edit .env with your API keys
```

2. **Enable LLM reflections:**
```javascript
// Before (v2.1.x)
const mesh = new MemoryMesh();

// After (v2.3.2) - LLM enabled by default
const mesh = new MemoryMesh({
  enableLLM: true
});
await mesh.reflect({ topic: 'bugs' });
```

3. **Enable YAMO audit:**
```javascript
const mesh = new MemoryMesh({
  enableYamo: true
});

// Query audit log
const log = await mesh.getYamoLog({ limit: 10 });
```

---

## Dependencies

**No new runtime dependencies** - all LLM integration uses native `fetch` (Node.js 18+).

**TypeScript Dev Dependencies:**
- `@types/node` ^25.0.9
- `typescript` ^5.9.3

---

## Performance Impact

| Operation | Before | After | Notes |
|-----------|--------|-------|-------|
| `add()` | ~50ms | ~50ms | YAMO emission is async (fire-and-forget) |
| `search()` | ~100ms | ~100ms | YAMO emission is async |
| `reflect()` | N/A | ~2-5s | LLM call time (depends on provider) |

**YAMO emission** is designed to be **non-blocking** - errors are caught and suppressed to avoid impacting main operations.

---

## Future Enhancements

**Blockchain Integration (Planned):**
- Schema includes `block_hash` and `prev_hash` fields
- Ready for YAMO-chain integration
- Immutable audit trail on blockchain

**Additional Features (Considered):**
- Streaming reflection generation
- Multi-agent reflection synthesis
- Reflection chaining (reflect on reflections)
- Custom reflection templates
- Reflection confidence calibration

---

## Changelog Summary

### Added
- Multi-provider LLM client (OpenAI, Anthropic, Ollama)
- Enhanced `reflect()` with LLM generation
- YAMO protocol audit trail with block emission
- YAMO log retrieval and filtering API
- LLM setup documentation
- Environment variable template
- Comprehensive test suite (9 tests)

### Changed
- `MemoryMesh` constructor: Added `enableLLM`, `enableYamo`, `agentId` options
- `reflect()`: Now generates insights via LLM and stores to memory
- `add()`: Emits YAMO retain blocks
- `search()`: Emits YAMO recall blocks
- README: Added LLM and YAMO documentation
- package.json: Version bump to 2.3.2

### Fixed
- Keyword search type handling bug

---

## Support

- **Documentation**: [docs/LLM_SETUP.md](docs/LLM_SETUP.md)
- **Implementation Plan**: [docs/plans/2026-01-19-enhance-reflect-functionality.md](docs/plans/2026-01-19-enhance-reflect-functionality.md)
- **Issues**: https://github.com/yamo-protocol/yamo-memory-mesh/issues
- **YAMO Protocol**: https://github.com/yamo-protocol

---

**End of Release Notes v2.3.2**
