import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LanceDBClient } from '../../lib/memory/adapters/client.js';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';
import { mockConnect } from '../mocks/lancedb.js';

describe('LanceDB Native FTS', () => {
  it('should support searchFts in client', async () => {
    // Inject mock connection with custom query to mock FTS returns
    const client = new LanceDBClient({
      uri: 'mem://fts-test',
      driver: {
        connect: async (uri) => {
          const conn = await mockConnect(uri);
          // Override createTable/openTable to return a mock table that supports search(string)
          conn.createTable = async (name, data, options) => {
            const table = {
              name,
              createIndex: async () => {},
              search: (queryStr: string) => {
                assert.strictEqual(queryStr, 'search query');
                return {
                  limit: (n: number) => ({
                    toArray: async () => [
                      {
                        id: 'doc-1',
                        content: 'Document 1 content matching query',
                        metadata: JSON.stringify({ source: 'test' }),
                        _score: 2.5
                      }
                    ]
                  })
                };
              }
            };
            return table as any;
          };
          return conn;
        }
      } as any
    });

    await client.connect();
    const results = await client.searchFts('search query', { limit: 5 });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'doc-1');
    assert.strictEqual(results[0].score, 2.5);
    assert.strictEqual(results[0].metadata.source, 'test');
  });

  it('should fallback to in-memory TF-IDF search if searchFts throws', async () => {
    const mesh = new MemoryMesh({
      dbDir: ':memory:',
      enableReranker: false,
      enableYamo: false
    });

    // Mock client.searchFts to throw an error
    await mesh.init();
    mesh.client.searchFts = async () => {
      throw new Error('FTS index not initialized or unsupported');
    };

    // Store a memory in-memory index
    mesh.keywordSearch.add('fallback-id', 'some specialized keyword match here', { source: 'test' });

    // Execute keyword-only search
    const results = await mesh.search('specialized keyword', { mode: 'keyword' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'fallback-id');
    assert.ok(results[0].score > 0);
  });
});
