import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('Cross-Encoder Reranker Integration', () => {
  it('should rerank candidates based on mocked cross-encoder scores in hybrid search', async () => {
    const mesh = new MemoryMesh({
      enableYamo: false,
      enableLLM: false,
      dbDir: ':memory:',
      enableReranker: true
    });

    await mesh.add('First memory about dogs', { id: 'doc-1' });
    await mesh.add('Second memory about cats', { id: 'doc-2' });

    // Mock embeddingFactory.rerank
    mesh.embeddingFactory.rerank = async (query: string, documents: string[]) => {
      // Let's make cats have a high logit, dogs a low logit
      return documents.map(doc => doc.includes('cats') ? 5.0 : -5.0);
    };

    // When querying "cats", "Second memory about cats" should rank first
    const results = await mesh.search('cats', { limit: 2, useCache: false });
    assert.strictEqual(results[0].content, 'Second memory about cats');

    // Clean up
    await mesh.close();
  });

  it('should use cross-encoder scores in smora()', async () => {
    const mesh = new MemoryMesh({
      enableYamo: false,
      enableLLM: false,
      dbDir: ':memory:',
      enableReranker: true
    });

    await mesh.add('First memory about dogs', { id: 'doc-1' });
    await mesh.add('Second memory about cats', { id: 'doc-2' });

    // Mock embeddingFactory.rerank
    mesh.embeddingFactory.rerank = async (query: string, documents: string[]) => {
      return documents.map(doc => doc.includes('cats') ? 5.0 : -5.0);
    };

    const smoraRes = await mesh.smora('cats', { limit: 2 });
    assert.strictEqual(smoraRes.results[0].content, 'Second memory about cats');
    assert.ok(smoraRes.results[0].semanticScore > 0.9); // sigmoid of 5.0 is ~0.993
    assert.ok(smoraRes.results[1].semanticScore < 0.1); // sigmoid of -5.0 is ~0.006

    // Clean up
    await mesh.close();
  });
});
