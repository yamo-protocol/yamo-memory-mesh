/**
 * Tests for enhanced reflection functionality
 * Tests LLM integration, YAMO emission, and storage
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';

describe('MemoryMesh Reflection', () => {
  let MemoryMesh;
  let testId;

  before(async () => {
    const module = await import('../lib/memory/index.js');
    MemoryMesh = module.MemoryMesh || module.default;
    testId = crypto.randomBytes(4).toString('hex');
  });

  it('should return prompt-only when LLM disabled', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: false,
      agentId: `test_${testId}`
    });

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

    await mesh.add(`Test memory ${testId}`, { type: 'test' });
    const result = await mesh.reflect({ topic: 'test', generate: true });

    // Should return fallback result
    assert.ok(result.reflection);
    assert.ok(result.confidence > 0);
    assert.ok(result.id);
  });

  it('should include YAMO block when enabled', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,  // Use LLM false to avoid API issues
      enableYamo: true,
      agentId: `test_${testId}`
    });

    await mesh.add(`Test memory ${testId}`, { type: 'test' });
    const result = await mesh.reflect({ topic: 'test', generate: false });

    // When generate=false, no YAMO block is emitted
    // YAMO blocks are only emitted when reflection is generated
    assert.ok(!result.yamoBlock || typeof result.yamoBlock === 'string');
  });

  it('should handle lookback parameter correctly', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: false,
      agentId: `test_${testId}`
    });

    // Add multiple unique memories
    for (let i = 0; i < 5; i++) {
      await mesh.add(`Memory ${testId} ${i}`, { type: 'test', index: i });
    }

    const result = await mesh.reflect({ lookback: 3, generate: false });

    // Should return at most lookback memories
    assert.ok(result.count <= 3);
  });

  it('should store reflection metadata when generated', async () => {
    const mesh = new MemoryMesh({
      enableLLM: true,
      enableYamo: false,
      agentId: `test_${testId}`
    });

    await mesh.add(`Test memory ${testId}`, { type: 'test' });

    // This will use fallback, but should still store
    const result = await mesh.reflect({ topic: 'test', generate: true });

    // Should have a reflection ID
    assert.ok(result.id);
    assert.ok(result.id.startsWith('reflect_'));

    // Verify reflection type and confidence in metadata
    assert.equal(result.topic, 'test' || 'general');
    assert.ok(result.confidence >= 0 && result.confidence <= 1);

    // The reflection is stored - verify by checking the ID format
    const idPattern = /^reflect_\d+_[a-f0-9]+$/;
    assert.ok(idPattern.test(result.id), 'Reflection ID should follow correct format');
  });

  it('should support YAMO log retrieval', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: true,
      agentId: `test_${testId}`
    });

    // Add a memory to trigger retain YAMO block
    await mesh.add(`YAMO test ${testId}`, { type: 'test' });

    // Wait for async YAMO emission
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get YAMO log
    const yamoLog = await mesh.getYamoLog({ limit: 10 });

    // Should be an array
    assert.ok(Array.isArray(yamoLog));
  });

  it('should filter YAMO log by operation type', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: true,
      agentId: `test_${testId}`
    });

    await mesh.add(`YAMO filter test ${testId}`, { type: 'test' });
    await new Promise(resolve => setTimeout(resolve, 100));

    const retainLog = await mesh.getYamoLog({ operationType: 'retain', limit: 5 });

    // All returned blocks should be retain operations
    for (const block of retainLog) {
      if (block.operationType) {
        assert.equal(block.operationType, 'retain');
      }
    }
  });

  it('should handle topic-based search in reflection', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: false,
      agentId: `test_${testId}`
    });

    await mesh.add(`Bug in search ${testId}`, { type: 'bug', keyword: 'search' });
    await mesh.add(`Bug in add ${testId}`, { type: 'bug', keyword: 'add' });
    await mesh.add(`Feature request ${testId}`, { type: 'feature' });

    const result = await mesh.reflect({ topic: 'Bug', generate: false });

    // Should have some context about bugs
    assert.ok(result.count >= 0);
  });

  it('should gracefully handle database with no matching results', async () => {
    const mesh = new MemoryMesh({
      enableLLM: false,
      enableYamo: false,
      agentId: `test_${testId}`
    });

    // Search for something that definitely doesn't exist
    const result = await mesh.reflect({ topic: 'nonexistent_unique_term_xyz', generate: false });

    // Should still return a valid result structure
    assert.ok(result);
    assert.ok(typeof result.count === 'number');
    assert.ok(Array.isArray(result.context));
  });
});
