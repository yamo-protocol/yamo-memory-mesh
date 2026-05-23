import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('Merkle State Anchoring', () => {
  it('should anchor unanchored YAMO blocks and build a Merkle Tree', async () => {
    const mesh = new MemoryMesh({
      enableYamo: true,
      enableLLM: false,
      dbDir: ':memory:'
    });

    // 1. Add some memories to generate unanchored YAMO retain blocks
    await mesh.add('Test memory number one', { type: 'event' });
    await mesh.add('Test memory number two', { type: 'event' });

    // Wait for async block emissions to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify there are unanchored blocks in yamoTable
    assert.ok(mesh.yamoTable !== null);
    const unanchoredBlocksBefore = await mesh.yamoTable.query().where("anchored_at IS NULL").toArray();
    assert.strictEqual(unanchoredBlocksBefore.length, 2);

    // 2. Perform anchoring
    const result = await mesh.anchor();
    assert.ok(result);
    assert.strictEqual(result.count, 2);
    assert.ok(typeof result.root === 'string' && result.root.length === 64);
    assert.strictEqual(result.updates.length, 2);

    // Verify block_hash and prev_hash are chained
    const block1 = result.updates[0];
    const block2 = result.updates[1];
    assert.strictEqual(block2.prev_hash, block1.block_hash);

    // Verify all blocks are now marked anchored
    const unanchoredBlocksAfter = await mesh.yamoTable.query().where("anchored_at IS NULL").toArray();
    assert.strictEqual(unanchoredBlocksAfter.length, 0);

    // Subsequent anchoring calls should return null
    const secondResult = await mesh.anchor();
    assert.strictEqual(secondResult, null);

    await mesh.close();
  });
});
