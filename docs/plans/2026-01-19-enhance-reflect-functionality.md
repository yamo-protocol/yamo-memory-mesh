# Implementation Plan: Enhanced Reflect Functionality

## Goal

Enhance the `reflect()` method in yamo-memory-mesh to match Hindsight's approach:
- Internal LLM call for reflection generation
- Auto-store results to memory
- Emit YAMO blocks for auditability
- Optional blockchain anchoring (future)

## Requirements

Based on user decisions:
- **LLM Strategy**: Internal LLM call (like Hindsight)
- **Storage**: Auto-store to memory
- **Blockchain**: Optional for now (prepare schema but don't implement)

## Architecture

### New Components

| Component | File | Purpose |
|-----------|------|---------|
| `YamoEmitter` | `lib/yamo/emitter.js` | Construct YAMO blocks from operations |
| `LLMClient` | `lib/llm/client.js` | Handle LLM API calls for reflection |
| `YamoSchema` | `lib/yamo/schema.js` | YAMO block storage schema |

### Modified Components

| Component | Changes |
|-----------|---------|
| `MemoryMesh.reflect()` | Call LLM, store result, emit YAMO block |
| `LanceDB schema` | Add `yamo_blocks` table support |
| `package.json` | Add LLM dependencies (optional) |

---

## Detailed Tasks

### Task 1: Create YAMO Emitter Module

**File**: `lib/yamo/emitter.js`

**Purpose**: Construct structured YAMO blocks for auditability

**Implementation**:
```javascript
export class YamoEmitter {
  /**
   * Build a YAMO block for reflect operation
   * @param {Object} params - { topic, memoryCount, agentId, reflection }
   * @returns {string} Formatted YAMO block
   */
  static buildReflectBlock(params) {
    const { topic, memoryCount, agentId, reflection, confidence } = params;

    return `agent: MemoryMesh_${agentId || 'default'};
intent: synthesize_insights_from_context;
context:
  topic;${topic || 'general'};
  memory_count;${memoryCount};
  timestamp;${new Date().toISOString()};
constraints:
  hypothesis;Reflection generates new insights from existing facts;
priority: high;
output:
  reflection;${reflection};
  confidence;${confidence || 0.8};
meta:
  rationale;Synthesized from ${memoryCount} relevant memories;
  observation;High-level belief formed from pattern recognition;
  confidence;${confidence || 0.8};
log: reflection_generated;timestamp;${new Date().toISOString()};memories;${memoryCount};
handoff: End;
`;
  }

  /**
   * Build a YAMO block for retain operation
   */
  static buildRetainBlock(params) {
    // Similar implementation for add() operations
  }

  /**
   * Build a YAMO block for recall operation
   */
  static buildRecallBlock(params) {
    // Similar implementation for search() operations
  }
}
```

**Acceptance Criteria**:
- [ ] `YamoEmitter` class created
- [ ] `buildReflectBlock()` method generates valid YAMO format
- [ ] `buildRetainBlock()` method generates valid YAMO format
- [ ] `buildRecallBlock()` method generates valid YAMO format

---

### Task 2: Create LLM Client Module

**File**: `lib/llm/client.js`

**Purpose**: Handle LLM API calls with fallback support

**Implementation**:
```javascript
export class LLMClient {
  constructor(config = {}) {
    this.provider = config.provider || process.env.LLM_PROVIDER || 'openai';
    this.apiKey = config.apiKey || process.env.LLM_API_KEY;
    this.model = config.model || process.env.LLM_MODEL || 'gpt-4o-mini';
    this.baseUrl = config.baseUrl || process.env.LLM_BASE_URL;
  }

  /**
   * Generate reflection from memories
   * @param {string} prompt - The reflection prompt
   * @param {Array} memories - Context memories
   * @returns {Promise<Object>} { reflection, confidence }
   */
  async reflect(prompt, memories) {
    const systemPrompt = `You are a reflective AI agent. Review the provided memories and synthesize a high-level insight, belief, or observation.
Respond in JSON format: { "reflection": "insight text", "confidence": 0.0-1.0 }`;

    const userContent = `Prompt: ${prompt}\n\nMemories:\n${memories.map((m, i) => `${i+1}. ${m.content}`).join('\n')}`;

    try {
      const response = await this._callLLM(systemPrompt, userContent);
      return JSON.parse(response);
    } catch (error) {
      // Fallback: return simple aggregation
      return {
        reflection: `Synthesized from ${memories.length} memories: ${memories.map(m => m.content).join('; ')}`,
        confidence: 0.5
      };
    }
  }

  async _callLLM(systemPrompt, userContent) {
    // Implementation based on provider (OpenAI, Anthropic, etc.)
    // Returns parsed response text
  }
}
```

**Acceptance Criteria**:
- [ ] `LLMClient` class created
- [ ] `reflect()` method calls LLM with memories
- [ ] Fallback behavior when LLM fails
- [ ] Returns `{ reflection, confidence }` object

---

### Task 3: Add YAMO Block Storage Schema

**File**: `lib/yamo/schema.js`

**Purpose**: Define schema for YAMO block persistence

**Implementation**:
```javascript
import * as arrow from "apache-arrow";

/**
 * Create YAMO blocks table schema
 * @returns {import('apache-arrow').Schema} Arrow schema for YAMO blocks
 */
export function createYamoSchema() {
  return new arrow.Schema([
    new arrow.Field('id', new arrow.Utf8(), false),
    new arrow.Field('agent_id', new arrow.Utf8(), true),
    new arrow.Field('operation_type', new arrow.Utf8(), false),  // 'retain', 'recall', 'reflect'
    new arrow.Field('yamo_text', new arrow.Utf8(), false),
    new arrow.Field('timestamp', new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), false),
    // Blockchain fields (optional, nullable)
    new arrow.Field('block_hash', new arrow.Utf8(), true),
    new arrow.Field('prev_hash', new arrow.Utf8(), true),
    // Metadata
    new arrow.Field('metadata', new arrow.Utf8(), true),  // JSON string
  ]);
}

/**
 * Create YAMO blocks table in LanceDB
 * @param {import('@lancedb/lancedb').Connection} db - LanceDB connection
 * @param {string} tableName - Name of the table (default: 'yamo_blocks')
 * @returns {Promise<import('@lancedb/lancedb').Table>} The created or opened table
 */
export async function createYamoTable(db, tableName = 'yamo_blocks') {
  const existingTables = await db.tableNames();

  if (existingTables.includes(tableName)) {
    return await db.openTable(tableName);
  }

  const schema = createYamoSchema();
  const table = await db.createTable(tableName, [], { schema });
  return table;
}
```

**Acceptance Criteria**:
- [ ] `createYamoSchema()` function defined
- [ ] `createYamoTable()` function creates/opens table
- [ ] Schema includes `block_hash` and `prev_hash` for future blockchain use

---

### Task 4: Update MemoryMesh Constructor

**File**: `lib/memory/memory-mesh.js`

**Changes**: Add YAMO and LLM client initialization

**Implementation**:
```javascript
import { YamoEmitter } from '../yamo/emitter.js';
import { LLMClient } from '../llm/client.js';

class MemoryMesh {
  constructor(options = {}) {
    // ... existing initialization ...

    // New: YAMO and LLM support
    this.enableYamo = options.enableYamo !== false;
    this.enableLLM = options.enableLLM !== false;
    this.agentId = options.agentId || 'default';

    if (this.enableYamo) {
      this.yamoClient = null;  // Will be initialized in init()
    }

    if (this.enableLLM) {
      this.llmClient = new LLMClient({
        provider: options.llmProvider,
        apiKey: options.llmApiKey,
        model: options.llmModel
      });
    }
  }

  async init() {
    // ... existing initialization ...

    // New: Initialize YAMO blocks table
    if (this.enableYamo && this.client) {
      const { createYamoTable } = await import('../yamo/schema.js');
      this.yamoTable = await createYamoTable(this.client.db, 'yamo_blocks');
    }
  }
}
```

**Acceptance Criteria**:
- [ ] `YamoEmitter` imported
- [ ] `LLMClient` imported and instantiated
- [ ] `yamoTable` initialized in `init()`
- [ ] Flags for enabling/disabling YAMO and LLM

---

### Task 5: Implement Enhanced reflect() Method

**File**: `lib/memory/memory-mesh.js`

**Replace**: Lines 331-361 (current `reflect()` implementation)

**New Implementation**:
```javascript
/**
 * Reflect on recent memories to generate insights (enhanced with LLM + YAMO)
 * @param {Object} options
 * @param {string} [options.topic] - Topic to search for
 * @param {number} [options.lookback=10] - Number of memories to consider
 * @param {boolean} [options.generate=true] - Whether to generate reflection via LLM
 * @returns {Promise<Object>} Reflection result with YAMO block
 */
async reflect(options = {}) {
  await this.init();

  const lookback = options.lookback || 10;
  const topic = options.topic;
  const generate = options.generate !== false;

  // Gather memories
  let memories = [];
  if (topic) {
    memories = await this.search(topic, { limit: lookback });
  } else {
    const all = await this.getAll();
    memories = all
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, lookback);
  }

  const prompt = `Review these memories. Synthesize a high-level "belief" or "observation".`;

  // Generate reflection if LLM enabled
  let reflection = null;
  let confidence = 0;

  if (generate && this.enableLLM && this.llmClient) {
    try {
      const result = await this.llmClient.reflect(prompt, memories);
      reflection = result.reflection;
      confidence = result.confidence;
    } catch (error) {
      console.warn(`[MemoryMesh] LLM reflection failed: ${error.message}`);
      // Fall back to simple aggregation
      reflection = `Aggregated from ${memories.length} memories on topic: ${topic || 'general'}`;
      confidence = 0.5;
    }
  } else {
    // Return prompt-only mode (backward compatible)
    return {
      topic,
      count: memories.length,
      context: memories.map(m => ({
        content: m.content,
        type: m.metadata?.type || 'event',
        id: m.id
      })),
      prompt
    };
  }

  // Store reflection to memory
  const reflectionId = `reflect_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  await this.add(reflection, {
    type: 'reflection',
    topic: topic || 'general',
    source_memory_count: memories.length,
    confidence,
    generated_at: new Date().toISOString()
  });

  // Emit YAMO block if enabled
  let yamoBlock = null;
  if (this.enableYamo) {
    yamoBlock = YamoEmitter.buildReflectBlock({
      topic: topic || 'general',
      memoryCount: memories.length,
      agentId: this.agentId,
      reflection,
      confidence
    });

    await this._emitYamoBlock('reflect', reflectionId, yamoBlock);
  }

  return {
    id: reflectionId,
    topic: topic || 'general',
    reflection,
    confidence,
    sourceMemoryCount: memories.length,
    yamoBlock,
    createdAt: new Date().toISOString()
  };
}

/**
 * Emit a YAMO block to the YAMO blocks table
 * @private
 * @param {string} operationType - 'retain', 'recall', 'reflect'
 * @param {string} memoryId - Associated memory ID
 * @param {string} yamoText - The YAMO block text
 */
async _emitYamoBlock(operationType, memoryId, yamoText) {
  if (!this.yamoTable) {
    if (process.env.YAMO_DEBUG === 'true') {
      console.warn('[MemoryMesh] YAMO table not initialized, skipping emission');
    }
    return;
  }

  const yamoId = `yamo_${operationType}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    await this.yamoTable.add([{
      id: yamoId,
      agent_id: this.agentId,
      operation_type: operationType,
      yamo_text: yamoText,
      timestamp: new Date(),
      block_hash: null,  // Future: blockchain anchoring
      prev_hash: null,
      metadata: JSON.stringify({
        memory_id: memoryId,
        timestamp: new Date().toISOString()
      })
    }]);

    if (process.env.YAMO_DEBUG === 'true') {
      console.log(`[MemoryMesh] YAMO block emitted: ${yamoId}`);
    }
  } catch (error) {
    console.error(`[MemoryMesh] Failed to emit YAMO block: ${error.message}`);
  }
}
```

**Acceptance Criteria**:
- [ ] Calls LLM when `enableLLM` is true
- [ ] Stores reflection result to memory
- [ ] Emits YAMO block when `enableYamo` is true
- [ ] Returns backward-compatible format when LLM disabled
- [ ] Handles LLM failures gracefully

---

### Task 6: Add YAMO Hooks to add() and search()

**File**: `lib/memory/memory-mesh.js`

**Purpose**: Emit YAMO blocks for retain (add) and recall (search) operations

**Changes to `add()` method**:
```javascript
// After successful add, emit YAMO block
if (this.enableYamo) {
  const yamoBlock = YamoEmitter.buildRetainBlock({
    content,
    metadata,
    id: result.id
  });
  await this._emitYamoBlock('retain', result.id, yamoBlock);
}
```

**Changes to `search()` method**:
```javascript
// After search completes, emit YAMO block
if (this.enableYamo) {
  const yamoBlock = YamoEmitter.buildRecallBlock({
    query,
    resultCount: results.length,
    limit: options.limit
  });
  await this._emitYamoBlock('recall', null, yamoBlock);
}
```

**Acceptance Criteria**:
- [ ] `add()` emits retain YAMO block
- [ ] `search()` emits recall YAMO block
- [ ] YAMO emission doesn't block main operations (async)

---

### Task 7: Add YAMO Query API

**File**: `lib/memory/memory-mesh.js`

**Purpose**: Retrieve YAMO blocks for audit/debugging

**Implementation**:
```javascript
/**
 * Get YAMO blocks for this agent
 * @param {Object} options - Query options
 * @param {string} [options.operationType] - Filter by operation type
 * @param {number} [options.limit=10] - Max results
 * @returns {Promise<Array>} List of YAMO blocks
 */
async getYamoLog(options = {}) {
  if (!this.yamoTable) {
    return [];
  }

  const limit = options.limit || 10;
  const operationType = options.operationType;

  let query = this.yamoTable.query();

  if (operationType) {
    query = query.where(`operation_type == '${operationType}'`);
  }

  const results = await query.limit(limit).execute();
  const blocks = [];

  for await (const batch of results) {
    const rows = batch.toArray();
    for (const row of rows) {
      blocks.push({
        id: row.id,
        agentId: row.agent_id,
        operationType: row.operation_type,
        yamoText: row.yamo_text,
        timestamp: row.timestamp,
        blockHash: row.block_hash,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      });
    }
  }

  return blocks;
}
```

**Acceptance Criteria**:
- [ ] `getYamoLog()` method implemented
- [ ] Supports filtering by `operationType`
- [ ] Supports `limit` parameter
- [ ] Returns empty array if YAMO not enabled

---

### Task 8: Update CLI to Support reflect()

**File**: `lib/memory/memory-mesh.js` (CLI handler section)

**Changes**:
```javascript
// In run() function, around line 964
} else if (action === 'reflect') {
  // Enhanced reflect with LLM
  const enableLLM = input.llm !== false;  // Default true
  const result = await mesh.reflect({
    topic: input.topic,
    lookback: input.limit || 10,
    generate: enableLLM
  });

  if (result.reflection) {
    // New format with LLM-generated reflection
    console.log(JSON.stringify({
      status: "ok",
      reflection: result.reflection,
      confidence: result.confidence,
      id: result.id,
      sourceMemoryCount: result.sourceMemoryCount,
      yamoBlock: result.yamoBlock
    }));
  } else {
    // Old format for backward compatibility
    console.log(JSON.stringify({ status: "ok", ...result }));
  }
}
```

**CLI Usage**:
```bash
# With LLM (default)
memory-mesh reflect '{"topic": "bugs", "limit": 10}'

# Without LLM (prompt only)
memory-mesh reflect '{"topic": "bugs", "llm": false}'
```

**Acceptance Criteria**:
- [ ] CLI supports `llm` parameter
- [ ] Returns enhanced format when LLM enabled
- [ ] Backward compatible when LLM disabled

---

### Task 9: Add Tests

**File**: `test/reflection.test.js`

**Test Cases**:
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('MemoryMesh Reflection', () => {
  it('should generate reflection via LLM', async () => {
    const mesh = new MemoryMesh({ enableLLM: true, llmClient: mockLLM });
    const result = await mesh.reflect({ topic: 'test', lookback: 5 });

    assert.ok(result.reflection);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.ok(result.yamoBlock);
  });

  it('should return prompt-only when LLM disabled', async () => {
    const mesh = new MemoryMesh({ enableLLM: false });
    const result = await mesh.reflect({ topic: 'test' });

    assert.ok(result.prompt);
    assert.ok(!result.reflection);
  });

  it('should store reflection to memory', async () => {
    const mesh = new MemoryMesh({ enableLLM: true, llmClient: mockLLM });
    await mesh.reflect({ topic: 'test' });

    const memories = await mesh.getAll();
    const reflection = memories.find(m => m.metadata?.type === 'reflection');
    assert.ok(reflection);
  });

  it('should emit YAMO block for reflect', async () => {
    const mesh = new MemoryMesh({ enableYamo: true, enableLLM: true, llmClient: mockLLM });
    const result = await mesh.reflect({ topic: 'test' });

    assert.ok(result.yamoBlock);
    assert.ok(result.yamoBlock.includes('agent: MemoryMesh_'));
  });
});
```

**Acceptance Criteria**:
- [ ] Test file created
- [ ] LLM generation test passes
- [ ] Prompt-only mode test passes
- [ ] Storage test passes
- [ ] YAMO emission test passes

---

### Task 10: Update Documentation

**Files**:
- `README.md`
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`

**Changes**:
1. Document new `reflect()` behavior
2. Add LLM configuration section
3. Document YAMO block storage
4. Add environment variables reference

**New Environment Variables**:
```bash
# LLM Configuration
LLM_PROVIDER=openai  # or 'anthropic', 'ollama'
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1  # optional

# YAMO Configuration
ENABLE_YAMO=true  # default: true
YAMO_DEBUG=true  # enable verbose logging
```

**Acceptance Criteria**:
- [ ] README updated with reflect() examples
- [ ] CLAUDE.md documents LLM integration
- [ ] Architecture docs updated with YAMO flow
- [ ] Environment variables documented

---

## Summary

| Task | Component | Est. Lines | Priority |
|------|-----------|------------|----------|
| 1 | YamoEmitter | ~80 | P0 |
| 2 | LLMClient | ~120 | P0 |
| 3 | YamoSchema | ~60 | P0 |
| 4 | Constructor updates | ~30 | P0 |
| 5 | Enhanced reflect() | ~120 | P0 |
| 6 | YAMO hooks | ~40 | P1 |
| 7 | YAMO query API | ~50 | P1 |
| 8 | CLI updates | ~30 | P1 |
| 9 | Tests | ~100 | P1 |
| 10 | Documentation | ~200 | P2 |
| **Total** | | **~830** | |

---

## Execution Order

1. **Task 1-3**: Create new infrastructure (emitter, LLM, schema)
2. **Task 4-5**: Core reflect() enhancement
3. **Task 6-7**: YAMO hooks and query API
4. **Task 8**: CLI integration
5. **Task 9**: Tests
6. **Task 10**: Documentation

---

## Success Criteria

- [ ] `reflect()` calls LLM and generates insights
- [ ] Reflections stored to memory automatically
- [ ] YAMO blocks emitted for reflect/retain/recall
- [ ] `getYamoLog()` retrieves audit trail
- [ ] Backward compatible when LLM disabled
- [ ] All tests passing
- [ ] Documentation complete
