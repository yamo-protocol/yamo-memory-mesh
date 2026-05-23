import { describe, it } from 'node:test';
import assert from 'node:assert';
import EmbeddingFactory from '../../lib/memory/embeddings/factory.js';

class MockService {
  modelName: string;
  initialized: boolean;
  failInit: boolean;
  failEmbed: boolean;

  constructor(config: any) {
    this.modelName = config.modelName;
    this.initialized = false;
    this.failInit = config.modelName.includes('fail-init');
    this.failEmbed = config.modelName.includes('fail-embed');
  }

  async init() {
    if (this.failInit) throw new Error('Init failed');
    this.initialized = true;
  }

  async embed(text: string) {
    if (this.failEmbed) throw new Error('Embed failed');
    return [0.1, 0.2, 0.3];
  }
  
  getStats() { return {}; }
  clearCache() {}
  async embedBatch(texts: string[]) {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
}

describe('EmbeddingFactory', () => {
  it('should configure services by priority', async () => {
    const factory = new (EmbeddingFactory as any)(MockService);
    factory.configure([
      { modelName: 'low-prio', priority: 2 },
      { modelName: 'high-prio', priority: 1 }
    ]);

    assert.strictEqual(factory.primaryService.modelName, 'high-prio');
    assert.strictEqual(factory.fallbackServices[0].modelName, 'low-prio');
  });

  it('should fallback if primary fails', async () => {
    const factory = new (EmbeddingFactory as any)(MockService);
    factory.configure([
      { modelName: 'fail-embed', priority: 1 },
      { modelName: 'backup', priority: 2 }
    ]);

    const vector = await factory.embed('test');
    assert.deepStrictEqual(vector, [0.1, 0.2, 0.3]);
  });

  it('should trigger cooldown and skip primary service on subsequent calls if primary fails', async () => {
    const factory = new (EmbeddingFactory as any)(MockService);
    let primaryCallCount = 0;

    factory.configure([
      { modelName: 'fail-embed', priority: 1 },
      { modelName: 'backup', priority: 2 }
    ]);

    const originalEmbed = factory.primaryService.embed;
    factory.primaryService.embed = async (text: string) => {
      primaryCallCount++;
      return originalEmbed.call(factory.primaryService, text);
    };

    // First call: fails on primary (primaryCallCount = 1), falls back to backup
    const vector1 = await factory.embed('test1');
    assert.deepStrictEqual(vector1, [0.1, 0.2, 0.3]);
    assert.strictEqual(primaryCallCount, 1);
    assert.ok(factory.primaryServiceFailedUntil > Date.now());

    // Second call: primary should be skipped because it's in cooldown, goes straight to backup
    const vector2 = await factory.embed('test2');
    assert.deepStrictEqual(vector2, [0.1, 0.2, 0.3]);
    assert.strictEqual(primaryCallCount, 1); // primaryCallCount should still be 1!
  });
});
