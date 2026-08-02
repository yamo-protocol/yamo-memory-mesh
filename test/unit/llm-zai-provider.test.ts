import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { LLMClient } from '../../lib/llm/client.js';

/**
 * zai provider support (workspace-bmr): the workspace routes reasoner traffic
 * to Zhipu GLM via api.z.ai, which speaks the OpenAI chat-completions dialect.
 * Before this, LLM_PROVIDER=zai threw 'Unsupported provider' on every
 * fire-and-forget LLM path (e.g. graph-RAG triple extraction inside add()).
 * All tests here are offline — no network calls succeed with an empty key.
 */
describe('LLMClient zai provider', () => {
  const SAVED: Record<string, string | undefined> = {};
  const VARS = ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL', 'ZAI_API_KEY'];

  before(() => {
    for (const v of VARS) {
      SAVED[v] = process.env[v];
      delete process.env[v];
    }
  });

  after(() => {
    for (const v of VARS) {
      if (SAVED[v] === undefined) delete process.env[v];
      else process.env[v] = SAVED[v];
    }
  });

  it('resolves zai-specific defaults (model + base URL)', () => {
    const client = new LLMClient({ provider: 'zai' });
    assert.strictEqual((client as any).model, 'glm-4.7');
    assert.strictEqual((client as any).baseUrl, 'https://api.z.ai/api/coding/paas/v4');
  });

  it('falls back to ZAI_API_KEY when LLM_API_KEY is unset', () => {
    process.env.ZAI_API_KEY = 'test-zai-key';
    try {
      const client = new LLMClient({ provider: 'zai' });
      assert.strictEqual((client as any).apiKey, 'test-zai-key');
      const other = new LLMClient({ provider: 'openai' });
      assert.strictEqual((other as any).apiKey, '', 'ZAI_API_KEY must not leak into other providers');
    } finally {
      delete process.env.ZAI_API_KEY;
    }
  });

  it('dispatches zai to the OpenAI-compatible path instead of throwing Unsupported provider', async () => {
    const client = new LLMClient({ provider: 'zai', maxRetries: 1 });
    await assert.rejects(
      () => client.complete('system', 'user'),
      (err: Error) => {
        assert.ok(!err.message.includes('Unsupported provider'), `should not be Unsupported provider, got: ${err.message}`);
        assert.ok(err.message.includes('key not configured'), `should fail fast on the missing key, got: ${err.message}`);
        return true;
      },
    );
  });
});
