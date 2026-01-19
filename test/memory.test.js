import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../lib/memory/memory-mesh.js';

describe('MemoryMesh Core', () => {
  it('should initialize successfully', async () => {
    const mesh = new MemoryMesh();
    assert.ok(mesh);
    assert.strictEqual(mesh.isInitialized, false);
  });

  // Note: We cannot easily test init() or add() without a mock vector DB and embedding model
  // as they rely on local ONNX models and LanceDB native modules.
  // Ideally, we would inject mocks here.
});
