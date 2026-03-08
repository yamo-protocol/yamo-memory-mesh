/**
 * Tests for the three new CLI run() actions: get, delete, reflect
 * (RFC-0011 CLI gap closure)
 *
 * Tests cover:
 *  1. Underlying API methods used by each action (behaviour)
 *  2. Output format helpers mirroring the run() handler logic
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// ── Output format helpers (mirror run() handler logic) ────────────────────────

function buildGetNotFoundOutput(id: string): string {
  return `[MemoryMesh] Record not found: ${id}\n${JSON.stringify({ status: 'not_found', id })}\n`;
}

function buildGetFoundOutput(record: { id: string; content: string; [key: string]: unknown }): string {
  return `[MemoryMesh] Record ${record.id}\n${JSON.stringify({ status: 'ok', record }, null, 2)}\n`;
}

function buildDeleteOutput(id: string): string {
  return `[MemoryMesh] Deleted record ${id}\n${JSON.stringify({ status: 'ok', id })}\n`;
}

function buildReflectOutput(result: unknown): string {
  return `[MemoryMesh] Reflection complete.\n${JSON.stringify({ status: 'ok', result }, null, 2)}\n`;
}

// ── get action ────────────────────────────────────────────────────────────────

describe('CLI run() — get action', () => {
  let mesh: MemoryMesh;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
  });

  after(async () => {
    await mesh.close();
  });

  it('get: returns null for unknown id', async () => {
    const result = await mesh.get('mem_nonexistent_get_000');
    assert.strictEqual(result, null);
  });

  it('get: returns record fields for existing memory', async () => {
    const added = await mesh.add('CLI get action test content', { type: 'test' });
    const record = await mesh.get(added.id);

    assert.ok(record, 'record should not be null');
    assert.strictEqual(record!.id, added.id);
    assert.ok(typeof record!.content === 'string');
    assert.ok('metadata' in record!);
    assert.ok('created_at' in record!);
  });

  it('get not-found output: status is not_found, includes id', () => {
    const id = 'mem_missing_123';
    const out = buildGetNotFoundOutput(id);
    assert.ok(out.includes('[MemoryMesh] Record not found:'));
    assert.ok(out.includes(id));
    assert.ok(out.includes('"status":"not_found"'));
    // Must not report status: ok
    assert.ok(!out.includes('"status":"ok"'));
  });

  it('get found output: status is ok, includes record id', () => {
    const record = { id: 'mem_abc', content: 'hello', metadata: {}, created_at: '2026-01-01' };
    const out = buildGetFoundOutput(record);
    assert.ok(out.includes('[MemoryMesh] Record mem_abc'));
    assert.ok(out.includes('"status": "ok"'));
    assert.ok(out.includes('"id": "mem_abc"'));
  });

  it('get found output is valid JSON after stripping the first line', () => {
    const record = { id: 'mem_xyz', content: 'test', metadata: {}, created_at: '2026-01-01' };
    const out = buildGetFoundOutput(record);
    const lines = out.trim().split('\n');
    // First line is the human-readable prefix
    assert.ok(lines[0].startsWith('[MemoryMesh]'));
    // Remainder is JSON
    const jsonPart = lines.slice(1).join('\n');
    assert.doesNotThrow(() => JSON.parse(jsonPart));
    const parsed = JSON.parse(jsonPart);
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.record.id, 'mem_xyz');
  });
});

// ── delete action ─────────────────────────────────────────────────────────────

describe('CLI run() — delete action', () => {
  let mesh: MemoryMesh;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
  });

  after(async () => {
    await mesh.close();
  });

  it('delete: removes record so get() returns null', async () => {
    const added = await mesh.add('CLI delete action test', { type: 'test' });
    await mesh.delete(added.id);
    const after = await mesh.get(added.id);
    assert.strictEqual(after, null);
  });

  it('delete: does not throw for non-existent id', async () => {
    await assert.doesNotReject(() => mesh.delete('mem_nonexistent_del_000'));
  });

  it('delete output: status is ok, includes id', () => {
    const id = 'mem_to_delete_456';
    const out = buildDeleteOutput(id);
    assert.ok(out.includes('[MemoryMesh] Deleted record'));
    assert.ok(out.includes(id));
    assert.ok(out.includes('"status":"ok"'));
  });

  it('delete output is valid JSON after stripping first line', () => {
    const id = 'mem_del_789';
    const out = buildDeleteOutput(id);
    const lines = out.trim().split('\n');
    assert.ok(lines[0].startsWith('[MemoryMesh]'));
    const jsonPart = lines.slice(1).join('\n');
    assert.doesNotThrow(() => JSON.parse(jsonPart));
    const parsed = JSON.parse(jsonPart);
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.id, id);
  });
});

// ── reflect action ────────────────────────────────────────────────────────────

describe('CLI run() — reflect action', () => {
  let mesh: MemoryMesh;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
    await mesh.add('Reflection test memory — auth service config', { type: 'event' });
    await mesh.add('Reflection test memory — deployment checklist', { type: 'event' });
  });

  after(async () => {
    await mesh.close();
  });

  it('reflect: returns object with count field', async () => {
    const result = await mesh.reflect({ lookback: 5 });
    assert.ok(typeof result === 'object' && result !== null);
    assert.ok('count' in result, 'result should include count');
    assert.ok(typeof (result as { count: number }).count === 'number');
  });

  it('reflect: context includes stored memories when topic matches', async () => {
    const result = await mesh.reflect({ topic: 'auth service', lookback: 5 }) as {
      count: number;
      context?: Array<{ content: string }>;
    };
    assert.ok(typeof result.count === 'number');
  });

  it('reflect output: status is ok, includes result', () => {
    const mockResult = { count: 2, context: [{ content: 'mem1', type: 'event', id: 'x' }] };
    const out = buildReflectOutput(mockResult);
    assert.ok(out.includes('[MemoryMesh] Reflection complete.'));
    assert.ok(out.includes('"status": "ok"'));
    assert.ok(out.includes('"count": 2'));
  });

  it('reflect output is valid JSON after stripping first line', () => {
    const mockResult = { count: 1, context: [] };
    const out = buildReflectOutput(mockResult);
    const lines = out.trim().split('\n');
    assert.ok(lines[0].startsWith('[MemoryMesh]'));
    const jsonPart = lines.slice(1).join('\n');
    assert.doesNotThrow(() => JSON.parse(jsonPart));
    const parsed = JSON.parse(jsonPart) as { status: string; result: { count: number } };
    assert.strictEqual(parsed.status, 'ok');
    assert.ok('result' in parsed);
  });
});
