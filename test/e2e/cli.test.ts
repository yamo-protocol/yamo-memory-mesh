import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const BIN_PATH = path.resolve('bin/memory_mesh.js');
const TEMP_DB_DIR = path.join(os.tmpdir(), `yamo-e2e-test-${Date.now()}`);

describe('MemoryMesh E2E (CLI)', () => {
  before(() => {
    if (!fs.existsSync(TEMP_DB_DIR)) {
      fs.mkdirSync(TEMP_DB_DIR, { recursive: true });
    }
    // Set environment variable for the test database
    process.env.LANCEDB_URI = TEMP_DB_DIR;
    process.env.LLM_PROVIDER = 'none'; // Disable LLM for basic CLI tests
  });

  after(() => {
    if (fs.existsSync(TEMP_DB_DIR)) {
      try {
        fs.rmSync(TEMP_DB_DIR, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Failed to cleanup temp DB: ${err}`);
      }
    }
  });

  it('should report statistics for an empty database', () => {
    const output = execSync(`node ${BIN_PATH} stats`, { encoding: 'utf8' });

    assert.ok(output.includes('Memories:'));
    assert.ok(output.includes('Path:'));
    assert.ok(output.includes('Status:'));
  });

  it('should store and retrieve a memory', () => {
    // 1. Store memory
    const storeOutput = execSync(
      `node ${BIN_PATH} store --content "YAMO Singularity is the future of agentic orchestration." --type test`,
      { encoding: 'utf8' }
    );
    assert.ok(storeOutput.includes('Ingested record'));

    // 2. Search memory
    const searchOutput = execSync(
      `node ${BIN_PATH} search "What is the future of orchestration?" --limit 1`,
      { encoding: 'utf8' }
    );
    assert.ok(searchOutput.includes('Recalled') || searchOutput.includes('Found'));
    assert.ok(searchOutput.includes('YAMO Singularity'));
  });

  it('should require --content flag for store command', () => {
    try {
      execSync(`node ${BIN_PATH} store`, { stdio: 'pipe' });
      assert.fail('Should have failed');
    } catch (error: any) {
      const stderr = error.stderr.toString();
      assert.ok(stderr.includes("required option '-c, --content <text>' not specified"));
    }
  });
});

/**
 * Lifecycle, portability, and health command coverage (workspace-xdn).
 * One stateful flow over a dedicated temp DB; env is passed per-call so
 * these tests cannot contaminate the block above (or vice versa).
 */
describe('MemoryMesh E2E (CLI) — lifecycle, portability, health', () => {
  const DB = path.join(os.tmpdir(), `yamo-e2e-lifecycle-${Date.now()}`);
  const DB2 = path.join(os.tmpdir(), `yamo-e2e-import-${Date.now()}`);
  const PULL_SRC = path.join(os.tmpdir(), `yamo-e2e-pull-${Date.now()}`);
  const EXPORT_FILE = path.join(os.tmpdir(), `yamo-e2e-export-${Date.now()}.jsonl`);

  const run = (args: string, db = DB) =>
    execSync(`node ${BIN_PATH} ${args}`, {
      encoding: 'utf8',
      env: { ...process.env, LANCEDB_URI: db, LLM_PROVIDER: 'none' },
    });

  const storeAndGetId = (args: string): string => {
    const out = run(`store ${args}`);
    const m = out.match(/Ingested record (\S+)/);
    assert.ok(m, `store output should contain a record id, got: ${out}`);
    return m![1];
  };

  before(() => {
    for (const d of [DB, DB2, PULL_SRC]) fs.mkdirSync(d, { recursive: true });
  });

  after(() => {
    for (const p of [DB, DB2, PULL_SRC]) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    try { fs.rmSync(EXPORT_FILE, { force: true }); } catch { /* best effort */ }
  });

  it('pin via store --key/--pin surfaces verbatim in prime', () => {
    run(`store --content "Always take a JSONL backup before LanceDB major upgrades." --type insight --key upgrade-rule --pin`);
    const out = run('prime');
    assert.ok(out.includes('Pinned (1)'), `prime should list one pinned memory, got: ${out}`);
    assert.ok(out.includes('JSONL backup'), 'pinned content should appear verbatim');
  });

  it('unpin removes the memory from prime', () => {
    run('unpin upgrade-rule');
    const out = run('prime');
    assert.ok(out.includes('Pinned (0)'), `prime should list no pinned memories, got: ${out}`);
  });

  it('set-state transitions lifecycle state and history records it', () => {
    const id = storeAndGetId('--content "Old routing approach based on static rules." --type decision');
    // DIAG (debug/e2e-getbyid-ci): CI-only "memory not found" from a fresh
    // process right after store. Probe which failure mode this is.
    let out: string;
    try {
      out = run(`set-state ${id} deprecated`);
    } catch (e: any) {
      console.error(`DIAG set-state failed immediately: ${e.stderr || e.stdout}`);
      try {
        console.error(`DIAG get --id: ${run(`get --id ${id}`).slice(0, 300)}`);
      } catch (ge: any) {
        console.error(`DIAG get --id ALSO failed: ${ge.stdout} ${ge.stderr}`);
      }
      console.error(`DIAG stats: ${run('stats').replace(/\n/g, ' | ').slice(0, 400)}`);
      try {
        console.error(`DIAG where-probe: ${execSync(`node ${path.resolve('test/e2e/diag-where.mjs')} ${DB} ${id}`, { encoding: 'utf8' })}`);
      } catch (we: any) {
        console.error(`DIAG where-probe failed: ${we.stdout} ${we.stderr}`);
      }
      execSync('sleep 3');
      try {
        out = run(`set-state ${id} deprecated`);
        console.error('DIAG retry after 3s SUCCEEDED — eventual-visibility race');
      } catch (e2: any) {
        console.error('DIAG retry after 3s failed too — row durably invisible to getById');
        throw e2;
      }
    }
    assert.ok(out.includes('deprecated'), `set-state output should confirm the new state, got: ${out}`);
    const hist = run(`history ${id}`);
    assert.ok(hist.includes('state'), `history should record the state field change, got: ${hist}`);
  });

  it('defer suppresses until a date and --clear removes the deferral', () => {
    const id = storeAndGetId('--content "Revisit provider pricing next quarter." --type insight');
    const deferred = run(`defer ${id} 2030-01-01`);
    assert.ok(deferred.includes('Deferred'), `defer should confirm, got: ${deferred}`);
    const cleared = run(`defer ${id} --clear`);
    assert.ok(cleared.includes('Cleared'), `defer --clear should confirm, got: ${cleared}`);
  });

  it('delete then restore recovers the memory from its revision snapshot', () => {
    const id = storeAndGetId('--content "Recoverable memory for the restore flow." --type event');
    run(`delete --id ${id}`);
    const restored = run(`restore ${id}`);
    assert.ok(restored.includes('Restored'), `restore should confirm, got: ${restored}`);
    const got = run(`get --id ${id}`);
    assert.ok(got.includes('Recoverable memory'), 'restored record should be retrievable');
  });

  it('export writes JSONL and import into a fresh DB re-embeds the rows', () => {
    const out = run(`export ${EXPORT_FILE}`);
    assert.ok(out.includes('Exported'), `export should confirm, got: ${out}`);
    assert.ok(fs.existsSync(EXPORT_FILE), 'export file should exist');
    const imported = run(`import ${EXPORT_FILE}`, DB2);
    assert.ok(imported.includes('imported'), `import should report counts, got: ${imported}`);
    const stats = run('stats', DB2);
    assert.ok(!stats.includes('Memories: 0'), 'imported DB should not be empty');
  });

  it('doctor passes all mechanical checks on a healthy store', () => {
    const out = run('doctor');
    assert.ok(out.includes('All checks passed'), `doctor should pass, got: ${out}`);
  });

  it('hygiene reports are clean on a fresh store (stale, orphans, stale-beliefs)', () => {
    assert.ok(run('stale').includes('No stale memories'));
    assert.ok(run('orphans').includes('No orphaned decision edges'));
    assert.ok(run('stale-beliefs').includes('No stale beliefs'));
  });

  it('pull bulk-ingests a directory by extension', () => {
    fs.writeFileSync(path.join(PULL_SRC, 'a.md'), '# Doc A\nKafka ordering holds only within a partition.');
    fs.writeFileSync(path.join(PULL_SRC, 'b.md'), '# Doc B\nBlue-green deploys roll back with a router flip.');
    fs.writeFileSync(path.join(PULL_SRC, 'ignored.txt'), 'not ingested');
    const out = run(`pull ${PULL_SRC} --extension ".md" --type documentation`);
    assert.ok(/2/.test(out), `pull should ingest the two .md files, got: ${out}`);
    const found = run('search "router flip rollback" --limit 3');
    assert.ok(found.includes('Doc B') || found.includes('router flip'), 'pulled content should be searchable');
  });

  it('reflect works without an LLM via the heuristic path', () => {
    const out = run('reflect --lookback 5');
    assert.ok(out.includes('Confidence') || out.includes('Reviewed'), `reflect should produce output, got: ${out}`);
  });
});
