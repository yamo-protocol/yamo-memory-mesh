import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('MemoryMesh Reflection', () => {
  let testId: string;

  before(async () => {
    testId = crypto.randomBytes(4).toString('hex');
  });

  it('should return prompt-only when LLM disabled', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: false,
      agentId: `test_${testId}`
    });

    await mesh.init();

    // Add unique test memories
    await mesh.add(`Test memory 1 ${testId}`, { type: 'event' });
    await mesh.add(`Test memory 2 ${testId}`, { type: 'event' });

    const result = await mesh.reflect({ topic: 'test', generate: false });

    assert.ok(result.prompt);
    assert.ok(!result.reflection);  // No reflection when LLM disabled
    assert.ok(result.count >= 2);  // At least our 2 memories
  });

  it('should use fallback when LLM fails', async () => {
    // No API key configured, should trigger fallback
    const mesh = new MemoryMesh({
      enableLLM: true,
      enableYamo: false,
      agentId: `test_${testId}`
    });

    await mesh.init();

    await mesh.add(`Test memory ${testId}`, { type: 'test' });
    const result = await mesh.reflect({ topic: 'test', generate: true });

    // Should return fallback result
    assert.ok(result.reflection);
    assert.ok(result.confidence > 0);
    assert.ok(result.id);
  });

  it('should handle lookback parameter correctly', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: false,
      agentId: `test_${testId}`
    });

    await mesh.init();

    // Add multiple unique memories
    for (let i = 0; i < 5; i++) {
      await mesh.add(`Memory ${testId} ${i}`, { type: 'test', index: i });
    }

    const result = await mesh.reflect({ lookback: 3, generate: false });

    // Should return at most lookback memories
    assert.ok(result.count <= 3);
  });

  it('should support YAMO log retrieval', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: true,
      agentId: `test_${testId}`
    });

    await mesh.init();

    // Add a memory to trigger retain YAMO block
    await mesh.add(`YAMO test ${testId}`, { type: 'test' });

    // Wait for async YAMO emission
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get YAMO log
    const yamoLog = await mesh.getYamoLog({ limit: 10 });

    // Should be an array
    assert.ok(Array.isArray(yamoLog));
  });
});
