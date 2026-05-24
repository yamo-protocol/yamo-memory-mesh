/**
 * Tests for entity canonicalization + word-boundary content matching
 * in Graph-RAG (workspace-hgm).
 *
 * Two-part fix being tested:
 * 1. _extractTriplesHeuristics is gated off by default (was noise)
 * 2. Entities are canonicalized at storage AND query time, and
 *    content-mention check uses word-boundary regex with plural
 *    tolerance (was substring includes — false positives like "Auth"
 *    matching "AuthService")
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

const mesh: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });

describe('MemoryMesh._canonicalizeEntity', () => {
  it('lowercases', () => {
    assert.strictEqual(mesh._canonicalizeEntity('JWT'), 'jwt');
    assert.strictEqual(mesh._canonicalizeEntity('LanceDB'), 'lancedb');
  });

  it('strips leading #', () => {
    assert.strictEqual(mesh._canonicalizeEntity('#authentication'), 'authentication');
  });

  it('normalizes hyphens and underscores to spaces', () => {
    assert.strictEqual(mesh._canonicalizeEntity('JWT-Token'), 'jwt token');
    assert.strictEqual(mesh._canonicalizeEntity('memory_mesh'), 'memory mesh');
  });

  it('strips trailing plural s', () => {
    assert.strictEqual(mesh._canonicalizeEntity('Tokens'), 'token');
    assert.strictEqual(mesh._canonicalizeEntity('Caches'), 'cache');
  });

  it('collapses internal whitespace and trims', () => {
    assert.strictEqual(mesh._canonicalizeEntity('  JWT   Token  '), 'jwt token');
  });

  it('returns empty for empty / non-string', () => {
    assert.strictEqual(mesh._canonicalizeEntity(''), '');
    assert.strictEqual(mesh._canonicalizeEntity(null), '');
    assert.strictEqual(mesh._canonicalizeEntity(123 as any), '');
  });

  it('unifies casing/plural variants', () => {
    const c = mesh._canonicalizeEntity.bind(mesh);
    const variants = ['JWT', 'jwt', 'JWTs', 'Jwt'];
    const canonicals = new Set(variants.map(c));
    assert.strictEqual(canonicals.size, 1, `expected all variants to canonicalize to one form, got ${[...canonicals]}`);
  });
});

describe('MemoryMesh._contentMentions', () => {
  it('matches case-insensitively', () => {
    assert.strictEqual(mesh._contentMentions('Using JWT for auth', 'jwt'), true);
    assert.strictEqual(mesh._contentMentions('using jwt for auth', 'JWT'), true);
  });

  it('respects word boundaries (no substring false positives)', () => {
    // The old `includes()` would have matched "auth" inside "AuthService"
    // and "Authorization" — both wrong.
    assert.strictEqual(mesh._contentMentions('AuthService is the gateway', 'auth'), false);
    assert.strictEqual(mesh._contentMentions('Authorization header required', 'auth'), false);
    // But a real word match should hit
    assert.strictEqual(mesh._contentMentions('We use auth for login', 'auth'), true);
  });

  it('tolerates simple plurals', () => {
    assert.strictEqual(mesh._contentMentions('We refresh tokens hourly', 'token'), true);
    assert.strictEqual(mesh._contentMentions('Issue a token on login', 'tokens'), true);
  });

  it('returns false for empty inputs', () => {
    assert.strictEqual(mesh._contentMentions('', 'jwt'), false);
    assert.strictEqual(mesh._contentMentions('text', ''), false);
    assert.strictEqual(mesh._contentMentions(null, 'jwt'), false);
  });
});

describe('MemoryMesh._extractTriplesHeuristics gating', () => {
  afterEach(() => {
    delete process.env.GRAPH_RAG_HEURISTIC_TRIPLES;
  });

  it('returns [] by default (no graph noise from PascalCase-pairing)', () => {
    const r = mesh._extractTriplesHeuristics('MemoryMesh implements vector storage via LanceDB');
    assert.deepStrictEqual(r, []);
  });

  it('emits canonicalized triples when GRAPH_RAG_HEURISTIC_TRIPLES=on', () => {
    process.env.GRAPH_RAG_HEURISTIC_TRIPLES = 'on';
    const r = mesh._extractTriplesHeuristics('MemoryMesh implements vector storage via LanceDB');
    assert.ok(r.length > 0);
    for (const t of r) {
      // Each source/target must be lowercased (canonicalized)
      assert.strictEqual(t.source, t.source.toLowerCase());
      assert.strictEqual(t.target, t.target.toLowerCase());
      assert.notStrictEqual(t.source, t.target, 'no self-loops');
    }
    // Should contain the memorymesh → lancedb edge
    const hasEdge = r.some((t: any) => t.source === 'memorymesh' && t.target === 'lancedb');
    assert.ok(hasEdge, 'expected canonicalized memorymesh → lancedb edge');
  });
});

describe('MemoryMesh._extractTriplesLLM canonicalization', () => {
  it('canonicalizes LLM-extracted source/target', async () => {
    const m: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    // Mock LLM to return mixed-case triples
    m.llmClient = {
      complete: async () => JSON.stringify([
        { source: 'JWT', target: 'Tokens', relation: 'has', weight: 0.9 },
        { source: '#Authentication', target: 'JWT', relation: 'uses', weight: 0.8 },
      ]),
    };
    const r = await m._extractTriplesLLM('JWT defines token format');
    assert.strictEqual(r.length, 2);
    // All entities lowercased + hashtag stripped + plurals stripped
    assert.strictEqual(r[0].source, 'jwt');
    assert.strictEqual(r[0].target, 'token');
    assert.strictEqual(r[1].source, 'authentication');
    assert.strictEqual(r[1].target, 'jwt');
  });

  it('drops self-loops emitted by LLM', async () => {
    const m: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    m.llmClient = {
      complete: async () => JSON.stringify([
        { source: 'JWT', target: 'JWTs', relation: 'is', weight: 1.0 }, // canonicalizes to jwt/jwt
        { source: 'jwt', target: 'token', relation: 'has', weight: 1.0 },
      ]),
    };
    const r = await m._extractTriplesLLM('any');
    assert.strictEqual(r.length, 1, 'self-loop should be dropped');
    assert.deepStrictEqual({ source: r[0].source, target: r[0].target }, { source: 'jwt', target: 'token' });
  });

  it('drops triples with empty endpoints', async () => {
    const m: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: true });
    m.llmClient = {
      complete: async () => JSON.stringify([
        { source: '', target: 'JWT', relation: 'x', weight: 1.0 },
        { source: 'JWT', target: '#', relation: 'x', weight: 1.0 },
        { source: 'JWT', target: 'Token', relation: 'x', weight: 1.0 },
      ]),
    };
    const r = await m._extractTriplesLLM('any');
    assert.strictEqual(r.length, 1, 'empty/punctuation-only endpoints should be dropped');
  });
});
