import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('Epistemic Belief Revision', () => {
  it('should supersede an old memory by replaces_memory_id', async () => {
    const mesh = new MemoryMesh({
      enableYamo: false,
      enableLLM: false,
      dbDir: ':memory:'
    });

    // 1. Add first memory
    const res1 = await mesh.add('The current contract address is 0x1111111111111111111111111111111111111111', { key: 'contract' });
    assert.ok(res1.id);

    // Verify it is active and retrievable
    const search1 = await mesh.search('contract address', { limit: 5, useCache: false });
    assert.strictEqual(search1.length, 1);
    assert.strictEqual(search1[0].id, res1.id);

    // 2. Add replacing memory referencing the first one's ID
    const res2 = await mesh.add('The current contract address is now 0x2222222222222222222222222222222222222222', {
      key: 'contract',
      replaces_memory_id: res1.id
    });

    // Verify the first memory is now superseded and only the new one is returned
    const search2 = await mesh.search('contract address', { limit: 5, useCache: false });
    assert.strictEqual(search2.length, 1);
    assert.strictEqual(search2[0].id, res2.id);

    // Verify the first record is in the DB but marked superseded
    const oldRecord = await mesh.client.getById(res1.id);
    assert.ok(oldRecord.superseded_at !== null);

    await mesh.close();
  });

  it('should supersede an old memory by key conflict tag automatically', async () => {
    const mesh = new MemoryMesh({
      enableYamo: false,
      enableLLM: false,
      dbDir: ':memory:'
    });

    // 1. Add memory with key 'api_key'
    const res1 = await mesh.add('OpenAI API Key is sk-proj-1234567890', { key: 'api_key' });
    
    // Verify it is active
    const search1 = await mesh.search('OpenAI API Key', { limit: 5, useCache: false });
    assert.strictEqual(search1.length, 1);
    assert.strictEqual(search1[0].id, res1.id);

    // 2. Add new memory with the same key 'api_key'
    const res2 = await mesh.add('OpenAI API Key has been rotated to sk-proj-0987654321', { key: 'api_key' });

    // Verify the old one was superseded automatically and only the new one is retrieved
    const search2 = await mesh.search('OpenAI API Key', { limit: 5, useCache: false });
    assert.strictEqual(search2.length, 1);
    assert.strictEqual(search2[0].id, res2.id);

    // Verify the first one is marked superseded in DB
    const oldRecord = await mesh.client.getById(res1.id);
    assert.ok(oldRecord.superseded_at !== null);

    await mesh.close();
  });
});
