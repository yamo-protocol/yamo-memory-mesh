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
    const output = execSync(`node ${BIN_PATH} stats '{}'`, { encoding: 'utf8' });
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}') + 1;
    const result = JSON.parse(output.substring(jsonStart, jsonEnd));
    
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.stats.count, 0);
  });

  it('should store and retrieve a memory', () => {
    // 1. Store memory
    const storePayload = JSON.stringify({
      content: "YAMO Singularity is the future of agentic orchestration.",
      metadata: { type: "test", importance: 1.0 }
    });
    
    const storeOutput = execSync(`node ${BIN_PATH} store '${storePayload}'`, { encoding: 'utf8' });
    assert.ok(storeOutput.includes('Ingested record'));

    // 2. Search memory
    const searchPayload = JSON.stringify({
      query: "What is the future of orchestration?",
      limit: 1
    });
    
    const searchOutput = execSync(`node ${BIN_PATH} search '${searchPayload}'`, { encoding: 'utf8' });
    assert.ok(searchOutput.includes('Found 1 matches'));
    assert.ok(searchOutput.includes('YAMO Singularity'));
  });

  it('should handle invalid JSON gracefully', () => {
    try {
      execSync(`node ${BIN_PATH} store 'invalid-json'`, { stdio: 'pipe' });
      assert.fail('Should have failed');
    } catch (error: any) {
      const stderr = error.stderr.toString();
      assert.ok(stderr.includes('Invalid JSON argument'));
    }
  });
});
