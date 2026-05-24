/**
 * Tests for LLM-driven HyDE expansion in smora().
 *
 * Mocks llmClient.complete to avoid hitting real APIs. Validates:
 * - Template fallback when LLM disabled
 * - LLM result used when LLM available
 * - Template fallback when LLM throws
 * - Template fallback on timeout
 * - Cache hit avoids second LLM call
 * - Empty / whitespace LLM responses fall back to template
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

const TEMPLATE_PREFIX = 'A document about ';

function makeMesh(opts: Record<string, unknown> = {}) {
  return new MemoryMesh({
    dbDir: ':memory:',
    enableYamo: false,
    enableLLM: true,
    ...opts,
  });
}

describe('MemoryMesh._generateHyDE', () => {
  let mesh: any;

  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('falls back to template when LLM is disabled', async () => {
    mesh = new MemoryMesh({
      dbDir: ':memory:',
      enableYamo: false,
      enableLLM: false,
    });
    const result = await mesh._generateHyDE('what is JWT?');
    assert.ok(result.startsWith(TEMPLATE_PREFIX), `expected template, got: ${result}`);
    assert.ok(result.includes('what is JWT?'));
  });

  it('uses LLM response when available', async () => {
    mesh = makeMesh();
    const llmResponse = 'JWT tokens are signed tokens containing claims. They include an exp field for expiration and an iss field for issuer.';
    let callCount = 0;
    mesh.llmClient.complete = async () => {
      callCount++;
      return llmResponse;
    };
    const result = await mesh._generateHyDE('what is JWT?');
    assert.strictEqual(result, llmResponse);
    assert.strictEqual(callCount, 1);
  });

  it('falls back to template when LLM throws', async () => {
    mesh = makeMesh();
    mesh.llmClient.complete = async () => {
      throw new Error('API down');
    };
    const result = await mesh._generateHyDE('what is JWT?');
    assert.ok(result.startsWith(TEMPLATE_PREFIX));
  });

  it('falls back to template on LLM timeout', async () => {
    process.env.HYDE_TIMEOUT_MS = '50';
    try {
      mesh = makeMesh();
      mesh.llmClient.complete = () =>
        new Promise((resolve) => setTimeout(() => resolve('too late'), 500));
      const t0 = Date.now();
      const result = await mesh._generateHyDE('slow query');
      const elapsed = Date.now() - t0;
      assert.ok(result.startsWith(TEMPLATE_PREFIX), 'expected template fallback on timeout');
      assert.ok(elapsed < 300, `expected fast fallback under 300ms, took ${elapsed}ms`);
    } finally {
      delete process.env.HYDE_TIMEOUT_MS;
    }
  });

  it('caches LLM result and skips second call for the same query', async () => {
    mesh = makeMesh();
    let callCount = 0;
    mesh.llmClient.complete = async () => {
      callCount++;
      return `LLM response ${callCount}`;
    };
    const r1 = await mesh._generateHyDE('cache me');
    const r2 = await mesh._generateHyDE('cache me');
    assert.strictEqual(r1, 'LLM response 1');
    assert.strictEqual(r2, 'LLM response 1', 'second call should be cached');
    assert.strictEqual(callCount, 1, 'LLM should be called exactly once');
  });

  it('does not cache different queries together', async () => {
    mesh = makeMesh();
    let callCount = 0;
    mesh.llmClient.complete = async () => `response ${++callCount}`;
    const r1 = await mesh._generateHyDE('query one');
    const r2 = await mesh._generateHyDE('query two');
    assert.notStrictEqual(r1, r2);
    assert.strictEqual(callCount, 2);
  });

  it('falls back to template when LLM returns empty / whitespace', async () => {
    mesh = makeMesh();
    mesh.llmClient.complete = async () => '   ';
    const result = await mesh._generateHyDE('empty test');
    assert.ok(result.startsWith(TEMPLATE_PREFIX));
  });
});

describe('MemoryMesh.smora HyDE integration', () => {
  let mesh: any;

  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('invokes the LLM HyDE path when enableHyDE=true and LLM available', async () => {
    mesh = makeMesh({ enableReranker: false });
    await mesh.add('JWT tokens carry expiration claims and signing metadata');
    let hydeCalls = 0;
    mesh.llmClient.complete = async (_sys: string, query: string) => {
      hydeCalls++;
      return `Hypothetical passage about ${query} with technical detail.`;
    };
    const r = await mesh.smora('how do tokens expire?', { limit: 3, enableHyDE: true });
    assert.strictEqual(hydeCalls, 1, 'HyDE should call LLM once per smora() invocation');
    assert.strictEqual(r.pipeline.queryExpanded, true);
  });

  it('skips LLM HyDE entirely when enableHyDE=false', async () => {
    mesh = makeMesh({ enableReranker: false });
    await mesh.add('JWT tokens carry expiration claims');
    let hydeCalls = 0;
    mesh.llmClient.complete = async () => {
      hydeCalls++;
      return 'should not be used';
    };
    const r = await mesh.smora('how do tokens expire?', { limit: 3, enableHyDE: false });
    assert.strictEqual(hydeCalls, 0);
    assert.strictEqual(r.pipeline.queryExpanded, false);
  });
});
