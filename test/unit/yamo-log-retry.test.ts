/**
 * Tests for getYamoLog() IO-corruption handling (workspace-77e).
 *
 * The YAMO audit trail is append-only and Merkle-anchored, so a read failure
 * must NEVER drop it. Verifies:
 * - Normal path returns mapped rows from yamoTable
 * - Non-retryable error breaks immediately and returns []
 * - IO error exhausting all retries disables the log (yamoTable = null) and
 *   does NOT destroy data — it quarantines the table instead
 * - _quarantineYamoTable preserves the table (moves it aside) + writes a marker
 * - init() refuses to recreate yamo_blocks while a corruption marker is present
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('getYamoLog() IO-corruption handling', () => {
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

  it('disables the log (does NOT drop the table) on IO corruption after all retries', async () => {
    // Point at a non-existent dir so the retry-refresh keeps failing and the
    // quarantine fs writes throw (caught) — the contract is that yamoTable ends
    // up null and getYamoLog never calls dropTable.
    const mesh = makeMesh('/nonexistent/path/that/does/not/exist');
    const ioError = new Error('LanceError(IO): No such file or directory: missing.lance');
    mesh.yamoTable = makeQueryTable([], ioError) as any;

    const result = await mesh.getYamoLog({ limit: 3 });
    assert.deepStrictEqual(result, []);
    assert.strictEqual(mesh.yamoTable, null, 'audit log should be disabled after corruption');
  });
});

describe('_quarantineYamoTable() preserves the audit trail', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamo-quarantine-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves the table aside and writes a marker instead of deleting', async () => {
    // Simulate an on-disk table directory with anchored data.
    const tableDir = path.join(tmpDir, 'yamo_blocks.lance');
    fs.mkdirSync(tableDir);
    fs.writeFileSync(path.join(tableDir, 'anchored.block'), 'merkle-anchored-audit-data');

    const mesh = makeMesh(tmpDir);
    await mesh._quarantineYamoTable(new Error('LanceError(IO): boom'));

    // Original table directory is gone from the active namespace...
    assert.ok(!fs.existsSync(tableDir), 'active table dir should be moved aside');
    // ...but preserved under a timestamped corrupt-* dir, data intact.
    const aside = fs.readdirSync(tmpDir).find((n) => n.startsWith('yamo_blocks.corrupt-'));
    assert.ok(aside, 'a quarantined copy should exist');
    const preserved = fs.readFileSync(path.join(tmpDir, aside!, 'anchored.block'), 'utf8');
    assert.strictEqual(preserved, 'merkle-anchored-audit-data', 'audit data must be preserved');
    // And a marker is written so init() requires operator intervention.
    assert.ok(fs.existsSync(path.join(tmpDir, 'yamo_blocks.CORRUPT')), 'corruption marker should exist');
  });

  it('is a no-op for in-memory stores', async () => {
    const mesh = makeMesh(':memory:');
    await assert.doesNotReject(() => mesh._quarantineYamoTable(new Error('boom')));
  });
});

describe('init() honors the yamo_blocks corruption marker', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamo-marker-'));
    fs.writeFileSync(path.join(tmpDir, 'yamo_blocks.CORRUPT'), JSON.stringify({ quarantinedAt: 'x', reason: 'test' }));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('leaves yamoTable null (audit log off) when the marker is present', async () => {
    const mesh = new MemoryMesh({ dbDir: tmpDir, enableLLM: false, enableYamo: true });
    await mesh.init();
    assert.strictEqual(mesh.yamoTable, null, 'yamo log must stay disabled until operator clears the marker');
    await mesh.close();
  });
});

describe('getYamoLog() ordering — real table (workspace-axl)', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamo-order-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns blocks newest-first via DB-side orderBy (LanceDB >= 0.30)', async () => {
    const mesh = new MemoryMesh({ dbDir: tmpDir, enableLLM: false, enableYamo: true });
    await mesh.init();
    assert.ok(mesh.yamoTable, 'yamo table should be enabled');
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await mesh._emitYamoBlock('retain', 'm1', 'block-oldest');
    await sleep(20);
    await mesh._emitYamoBlock('retain', 'm2', 'block-middle');
    await sleep(20);
    await mesh._emitYamoBlock('retain', 'm3', 'block-newest');

    const log = await mesh.getYamoLog({ limit: 3 });
    assert.deepStrictEqual(
      log.map((r: any) => r.yamoText),
      ['block-newest', 'block-middle', 'block-oldest'],
    );

    // Limit is applied AFTER the DB-side sort, so top-1 is the newest row.
    const top1 = await mesh.getYamoLog({ limit: 1 });
    assert.deepStrictEqual(top1.map((r: any) => r.yamoText), ['block-newest']);
    await mesh.close();
  });
});
