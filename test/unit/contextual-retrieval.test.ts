import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Chunker } from '../../lib/scrubber/stages/chunker.js';
import { Scrubber } from '../../lib/scrubber/scrubber.js';

describe('Contextual Retrieval (Situated Chunking)', () => {
  it('should prepend document context to text in Chunker', async () => {
    const chunker = new Chunker({
      minTokens: 1,
      maxTokens: 100,
      hardMaxTokens: 200,
    });

    const content = 'First sentence. Second sentence.';
    const options = { documentContext: 'Global Context metadata information' };
    const chunks = await chunker.chunk(content, options);

    assert.strictEqual(chunks.length, 1);
    assert.ok(chunks[0].text.startsWith('[Document Context: Global Context metadata information]'));
    assert.ok(chunks[0].text.includes('First sentence.'));
    assert.strictEqual(chunks[0].metadata.hasSituatedContext, true);
    assert.ok(chunks[0].metadata.tokens > 5);
  });

  it('should propagate documentContext through Scrubber', async () => {
    const scrubber = new Scrubber({
      enabled: true,
      chunking: {
        minTokens: 1,
        maxTokens: 100,
        hardMaxTokens: 200,
      }
    });

    const document = {
      content: 'This is a test content block.',
      source: 'test-source',
      type: 'txt',
      documentContext: 'Scrubber system context'
    };

    const result = await scrubber.process(document);
    assert.strictEqual(result.success, true);
    assert.ok(result.chunks.length > 0);
    assert.ok(result.chunks[0].text.startsWith('[Document Context: Scrubber system context]'));
    assert.strictEqual(result.chunks[0].metadata.hasSituatedContext, true);
  });
});
