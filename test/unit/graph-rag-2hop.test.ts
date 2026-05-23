import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('Graph-RAG 2-Hop Boosting', () => {
  it('should apply dual-tier boosting for 1-hop and 2-hop connected entities', async () => {
    const mesh = new MemoryMesh({
      dbDir: ':memory:',
      enableReranker: false,
      enableYamo: false
    });

    await mesh.init();

    // Mock graphTable query results
    // We search for "EntityA"
    // EntityA -> EntityB (1-hop)
    // EntityB -> EntityC (2-hop)
    mesh.graphTable = {
      query: () => ({
        where: (filterExpr: string) => {
          return {
            toArray: async () => {
              if (filterExpr.includes("'EntityA'")) {
                // 1-hop edges query
                return [
                  { source: 'EntityA', target: 'EntityB', relation: 'uses', weight: 1.0 }
                ];
              }
              if (filterExpr.includes("'EntityB'")) {
                // 2-hop edges query
                return [
                  { source: 'EntityB', target: 'EntityC', relation: 'uses', weight: 1.0 }
                ];
              }
              return [];
            }
          };
        }
      })
    } as any;

    // We mock vector search results
    // Doc 1 contains "EntityB" (1-hop connected)
    // Doc 2 contains "EntityC" (2-hop connected)
    // Doc 3 contains "EntityD" (unconnected)
    mesh.client = {
      search: async () => [
        { id: 'doc-1', content: 'This doc mentions entity EntityB.', metadata: {}, _distance: 0.8 },
        { id: 'doc-2', content: 'This doc mentions entity EntityC.', metadata: {}, _distance: 0.8 },
        { id: 'doc-3', content: 'This doc mentions entity EntityD.', metadata: {}, _distance: 0.8 }
      ],
      searchFts: async () => []
    } as any;

    // Run search for "EntityA"
    const results = await mesh.search('EntityA', { mode: 'vector' });

    assert.strictEqual(results.length, 3);
    
    // Find docs in result
    const doc1 = results.find(r => r.id === 'doc-1');
    const doc2 = results.find(r => r.id === 'doc-2');
    const doc3 = results.find(r => r.id === 'doc-3');

    assert.ok(doc1);
    assert.ok(doc2);
    assert.ok(doc3);

    // Baseline similarity score for distance 0.8 is 1 - 0.8/2 = 0.60
    // Doc 3 (unconnected) should have baseline 0.60
    assert.strictEqual(doc3.score, 0.60);

    // Doc 1 (1-hop connection) gets 1.15x boost: 0.60 * 1.15 = 0.69
    assert.strictEqual(doc1.score, 0.69);

    // Doc 2 (2-hop connection) gets 1.07x boost: 0.60 * 1.07 = 0.64
    assert.strictEqual(doc2.score, 0.64);

    // Verify ordering: doc-1 (highest score) -> doc-2 -> doc-3
    assert.strictEqual(results[0].id, 'doc-1');
    assert.strictEqual(results[1].id, 'doc-2');
    assert.strictEqual(results[2].id, 'doc-3');
  });
});
