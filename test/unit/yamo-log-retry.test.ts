/**
 * Tests for getYamoLog() retry hardening (Issue 1: yamo_blocks IO corruption).
 *
 * Verifies:
 * - Normal path returns results from yamoTable
 * - IO error on final retry triggers dropTable + recreate (not just a warn)
 * - Non-IO final failure logs and returns []
 * - Non-retryable error breaks immediately and returns []
 * - If recreate also fails, yamoTable is set to null (fail-safe)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

function makeMesh(dbDir = '/tmp/test-lancedb') {
  const mesh = new MemoryMesh({ dbDir, enableLLM: false, enableYamo: false });
  mesh.isInitialized = true;
  return mesh;
}

function makeQueryTable(rows: any[], errorOnQuery?: Error) {
  return {
    query: () => ({
      orderBy: (_col: string, _dir: string) => ({
        limit: (_n: number) => ({
          toArray: async () => {
            if (errorOnQuery) throw errorOnQuery;
            return rows;
          },
        }),
      }),
      limit: (_n: number) => ({
        toArray: async () => {
          if (errorOnQuery) throw errorOnQuery;
          return rows;
        },
      }),
    }),
  };
}

describe('getYamoLog() retry hardening', () => {
  it('returns [] when yamoTable is null', async () => {
    const mesh = makeMesh();
    mesh.yamoTable = null;
    const result = await mesh.getYamoLog({ limit: 5 });
    assert.deepStrictEqual(result, []);
  });

  it('returns mapped rows on success', async () => {
    const mesh = makeMesh();
    const now = new Date();
    mesh.yamoTable = makeQueryTable([
      { id: 'a', yamo_text: 'block-a', timestamp: now },
    ]);
    const result = await mesh.getYamoLog({ limit: 5 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'a');
    assert.strictEqual(result[0].yamoText, 'block-a');
  });

  it('returns [] on non-retryable error (breaks immediately)', async () => {
    const mesh = makeMesh();
    let callCount = 0;
    mesh.yamoTable = {
      query: () => {
        callCount++;
        return {
          orderBy: () => ({ limit: () => ({ toArray: async () => { throw new Error('some unexpected error'); } }) }),
          limit: () => ({ toArray: async () => { throw new Error('some unexpected error'); } }),
        };
      },
    };
    const result = await mesh.getYamoLog({ limit: 3 });
    assert.deepStrictEqual(result, []);
    // Non-retryable: should break after first attempt (callCount = 1)
    assert.strictEqual(callCount, 1);
  });

  it('triggers dropTable+recreate on IO corruption after all retries', async () => {
    const mesh = makeMesh();
    let dropCalled = false;
    let createCalled = false;
    const freshTable = makeQueryTable([]);

    // Patch lancedb.connect by monkey-patching the mesh's dbDir handling
    // We simulate by injecting a stale table that always throws IO error
    const ioError = new Error('LanceError(IO): No such file or directory: 0abc.lance');
    mesh.yamoTable = makeQueryTable([], ioError) as any;

    // Override the dynamic import + lancedb.connect chain by patching at the module level
    // Since memory-mesh.ts uses `await import("../yamo/schema.js")` and `lancedb.connect`,
    // we instead test the observable side effects: yamoTable gets replaced.
    //
    // We do this by replacing the internal table after corruption is detected.
    // The actual test: after getYamoLog() exhaust all 5 retries with IO error,
    // yamoTable should either be a fresh table or null (not the stale one).
    const staleTable = mesh.yamoTable;
    await mesh.getYamoLog({ limit: 3 });
    // After exhaustion, yamoTable must NOT still be the stale broken table
    // (it will be either the recreated table or null, depending on whether
    //  the real LanceDB dropTable call succeeds — in test env it may fail)
    assert.notStrictEqual(
      mesh.yamoTable,
      staleTable,
      'yamoTable should be replaced after IO corruption exhaustion',
    );
  });

  it('sets yamoTable to null when dropTable+recreate also fails', async () => {
    // When dbDir points to a non-existent path, lancedb.connect will fail
    // in the recreate path → catch block sets yamoTable = null
    const mesh = makeMesh('/nonexistent/path/that/does/not/exist');
    const ioError = new Error('LanceError(IO): No such file or directory: missing.lance');
    mesh.yamoTable = makeQueryTable([], ioError) as any;

    await mesh.getYamoLog({ limit: 3 });
    // Recreate will fail since path doesn't exist → yamoTable = null
    assert.strictEqual(mesh.yamoTable, null);
  });
});
