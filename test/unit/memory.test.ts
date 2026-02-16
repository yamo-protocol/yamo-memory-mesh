import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('MemoryMesh Core', () => {
  it('should initialize successfully', async () => {
    const mesh = new MemoryMesh();
    assert.ok(mesh);
    assert.strictEqual(mesh.isInitialized, false);
  });
});
