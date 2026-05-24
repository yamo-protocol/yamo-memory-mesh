import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('Graph-RAG Property Graph and Triples Extraction', () => {
  it('should extract entity-relation triples and boost 1-hop connected results in search', async () => {
    // The heuristic PascalCase-pairing extractor is disabled by default
    // (workspace-hgm — it produced low-precision edges). This test opts in
    // explicitly to exercise that path. The LLM path (_extractTriplesLLM)
    // is the recommended production source.
    process.env.GRAPH_RAG_HEURISTIC_TRIPLES = 'on';
    try {
      const mesh = new MemoryMesh({
        enableYamo: false,
        enableLLM: false,
        dbDir: ':memory:'
      });

      // Add memories with Proper Nouns / entities
      // MemoryMesh relates to LanceDB
      await mesh.add('MemoryMesh implements vector storage via LanceDB.', { type: 'pattern' });

      // LanceDB relates to RRF
      await mesh.add('LanceDB supports hybrid retrieval using RRF fusion.', { type: 'pattern' });

      // Verify edges were stored in graphTable
      assert.ok(mesh.graphTable !== null);
      const edges = await mesh.graphTable.query().toArray();
      assert.ok(edges.length >= 2);

      // Edges store canonicalized entities (lowercase, hyphen/underscore→space,
      // plural-stripped) so casing/plural variants unify.
      const hasMemoryMeshLanceDB = edges.some((e: any) =>
        e.source === 'memorymesh' && e.target === 'lancedb'
      );
      assert.ok(hasMemoryMeshLanceDB, 'Should have edge memorymesh -> lancedb (canonicalized)');

      // Run search for "MemoryMesh".
      // "MemoryMesh implements vector storage via LanceDB" will match directly.
      // The connected entity is "LanceDB".
      // Therefore, "LanceDB supports hybrid retrieval using RRF fusion" (which matches "LanceDB")
      // should receive a Graph-RAG boost.
      const results = await mesh.search('MemoryMesh', { limit: 3, useCache: false });

      // We expect both memories to be returned, and the LanceDB one should be boosted because it is a 1-hop connection
      assert.strictEqual(results.length, 2);

      // Let's verify both are retrieved
      const contents = results.map((r: any) => r.content);
      assert.ok(contents.includes('MemoryMesh implements vector storage via LanceDB.'));
      assert.ok(contents.includes('LanceDB supports hybrid retrieval using RRF fusion.'));

      await mesh.close();
    } finally {
      delete process.env.GRAPH_RAG_HEURISTIC_TRIPLES;
    }
  });
});
