/**
 * Tests for YamoEmitter — RFC-0011 §3.2 ABNF format + RFC-0014 escaping
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { YamoEmitter } from '../../lib/yamo/emitter.js';

// ── buildReflectBlock ────────────────────────────────────────────────────────

describe('YamoEmitter.buildReflectBlock', () => {
  it('contains required sections', () => {
    const block = YamoEmitter.buildReflectBlock({
      topic: 'testing',
      memoryCount: 3,
      reflection: 'Tests are good',
      confidence: 0.9,
    });
    assert.ok(block.includes('agent:'));
    assert.ok(block.includes('intent: synthesize_insights_from_context'));
    assert.ok(block.includes('context:'));
    assert.ok(block.includes('output:'));
    assert.ok(block.includes('log:'));
    assert.ok(block.includes('handoff: End'));
  });

  it('RFC-0014: encodes semicolons in topic as %3B', () => {
    const block = YamoEmitter.buildReflectBlock({
      topic: 'auth;bypass',
      memoryCount: 1,
      reflection: 'risk detected',
    });
    assert.ok(block.includes('auth%3Bbypass'), 'topic semicolon must be %3B');
    assert.ok(!block.includes('auth;bypass'), 'raw semicolon must not appear in topic');
  });

  it('RFC-0014: encodes semicolons in reflection as %3B', () => {
    const block = YamoEmitter.buildReflectBlock({
      memoryCount: 2,
      reflection: 'step one; step two',
    });
    assert.ok(block.includes('step one%3B step two'));
  });

  it('RFC-0014: encodes semicolons in agentId as %3B', () => {
    const block = YamoEmitter.buildReflectBlock({
      agentId: 'agent;injected',
      memoryCount: 1,
      reflection: 'r',
    });
    assert.ok(block.includes('MemoryMesh_agent%3Binjected'));
  });
});

// ── buildRetainBlock ─────────────────────────────────────────────────────────

describe('YamoEmitter.buildRetainBlock', () => {
  it('contains required sections', () => {
    const block = YamoEmitter.buildRetainBlock({
      content: 'hello world',
      id: 'mem_001',
    });
    assert.ok(block.includes('agent:'));
    assert.ok(block.includes('intent: store_memory_for_future_retrieval'));
    assert.ok(block.includes('memory_id'));
    assert.ok(block.includes('handoff: End'));
  });

  it('RFC-0014: encodes semicolons in content as %3B (not comma)', () => {
    const block = YamoEmitter.buildRetainBlock({
      content: 'key: value; other: val',
      id: 'mem_semi',
    });
    assert.ok(block.includes('%3B'), 'semicolons in content must be %3B encoded');
    // Old behaviour was comma — must not appear as a substitution
    assert.ok(!block.includes('value, other'), 'must not use comma as semicolon substitute');
  });

  it('RFC-0014: encodes semicolons in id as %3B', () => {
    const block = YamoEmitter.buildRetainBlock({
      content: 'content',
      id: 'mem;bad',
    });
    assert.ok(block.includes('mem%3Bbad'));
  });

  it('RFC-0014: encodes semicolons in memoryType as %3B', () => {
    const block = YamoEmitter.buildRetainBlock({
      content: 'content',
      id: 'mem_002',
      memoryType: 'lesson;critical',
    });
    assert.ok(block.includes('lesson%3Bcritical'));
  });
});

// ── buildRecallBlock ─────────────────────────────────────────────────────────

describe('YamoEmitter.buildRecallBlock', () => {
  it('contains required sections', () => {
    const block = YamoEmitter.buildRecallBlock({
      query: 'find auth lessons',
      resultCount: 3,
    });
    assert.ok(block.includes('intent: retrieve_relevant_memories'));
    assert.ok(block.includes('results_count;3'));
  });

  it('RFC-0014: encodes semicolons in query as %3B', () => {
    const block = YamoEmitter.buildRecallBlock({
      query: 'auth; bypass; attack',
      resultCount: 0,
    });
    assert.ok(block.includes('auth%3B bypass%3B attack'));
    assert.ok(!block.includes('auth; bypass'));
  });
});

// ── buildDeleteBlock ─────────────────────────────────────────────────────────

describe('YamoEmitter.buildDeleteBlock', () => {
  it('contains required sections', () => {
    const block = YamoEmitter.buildDeleteBlock({ id: 'mem_del_001' });
    assert.ok(block.includes('intent: remove_memory_from_storage'));
    assert.ok(block.includes('mem_del_001'));
    assert.ok(block.includes('handoff: End'));
  });

  it('RFC-0014: encodes semicolons in reason as %3B', () => {
    const block = YamoEmitter.buildDeleteBlock({
      id: 'mem_003',
      reason: 'user;requested;removal',
    });
    assert.ok(block.includes('user%3Brequested%3Bremoval'));
  });
});

// ── validateBlock ────────────────────────────────────────────────────────────

describe('YamoEmitter.validateBlock', () => {
  it('validates a well-formed block', () => {
    const block = YamoEmitter.buildRetainBlock({
      content: 'test content',
      id: 'mem_v',
    });
    const result = YamoEmitter.validateBlock(block);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  it('reports missing required sections', () => {
    const bad = 'agent: TestAgent;\nintent: do_something;\nhandoff: End;\n';
    const result = YamoEmitter.validateBlock(bad);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e: string) => e.includes('context:')));
    assert.ok(result.errors.some((e: string) => e.includes('output:')));
    assert.ok(result.errors.some((e: string) => e.includes('log:')));
  });
});
