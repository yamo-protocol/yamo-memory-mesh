import { describe, it } from 'node:test';
import assert from 'node:assert';
import EmbeddingFactory from '../lib/embeddings/factory.js';

class MockService {
  constructor(config) {
    this.modelName = config.modelName;
    this.initialized = false;
    this.failInit = config.modelName.includes('fail-init');
    this.failEmbed = config.modelName.includes('fail-embed');
  }

  async init() {
    if (this.failInit) throw new Error('Init failed');
    this.initialized = true;
  }

  async embed(text) {
    if (this.failEmbed) throw new Error('Embed failed');
    return [0.1, 0.2, 0.3];
  }
  
  getStats() { return {}; }
  clearCache() {}
}

describe('EmbeddingFactory', () => {
  it('should configure services by priority', async () => {
    const factory = new EmbeddingFactory(MockService);
    factory.configure([
      { modelName: 'low-prio', priority: 2 },
      { modelName: 'high-prio', priority: 1 }
    ]);

    assert.strictEqual(factory.primaryService.modelName, 'high-prio');
    assert.strictEqual(factory.fallbackServices[0].modelName, 'low-prio');
  });

  it('should fallback if primary fails', async () => {
    const factory = new EmbeddingFactory(MockService);
    factory.configure([
      { modelName: 'fail-embed', priority: 1 },
      { modelName: 'backup', priority: 2 }
    ]);

    const vector = await factory.embed('test');
    assert.deepStrictEqual(vector, [0.1, 0.2, 0.3]);
  });
});
