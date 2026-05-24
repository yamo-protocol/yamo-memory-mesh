/**
 * Tests for batched cross-encoder reranking in EmbeddingFactory.
 *
 * These intercept the underlying transformer model so the tests stay fast
 * and offline. The goal is to validate the batching contract — tokenizer
 * called with arrays, scores returned in document order, batch-size
 * chunking honored — not to validate the upstream model itself.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import EmbeddingFactory from '../../lib/memory/embeddings/factory.js';

interface CallRecord {
  queries: string[];
  docs: string[];
}

function installMockReranker(factory: any, opts: { numLabels?: number } = {}) {
  const numLabels = opts.numLabels ?? 1;
  const calls: CallRecord[] = [];
  const mockTokenizer = async (queries: string[], { text_pair }: { text_pair: string[] }) => {
    calls.push({ queries: [...queries], docs: [...text_pair] });
    return { input_ids: queries, attention_mask: queries };
  };
  const mockModel = async (inputs: any) => {
    const batch = inputs.input_ids.length;
    // Score each pair as docs[i].length so we can verify ordering.
    const data = new Float32Array(batch * numLabels);
    for (let i = 0; i < batch; i++) {
      const docLen = calls[calls.length - 1].docs[i].length;
      // For multi-label outputs, fill all label slots with docLen; only
      // logits.data[i*numLabels] (the first label) is consumed.
      for (let j = 0; j < numLabels; j++) {
        data[i * numLabels + j] = docLen;
      }
    }
    return { logits: { data, dims: [batch, numLabels] } };
  };
  factory.rerankerTokenizer = mockTokenizer;
  factory.rerankerModel = mockModel;
  return calls;
}

describe('EmbeddingFactory.rerank — batched cross-encoder', () => {
  let factory: any;

  beforeEach(() => {
    factory = new EmbeddingFactory();
  });

  it('returns one score per document in original order', async () => {
    installMockReranker(factory);
    const docs = ['a', 'bbbb', 'cc'];
    const scores = await factory.rerank('query', docs);
    assert.deepStrictEqual(scores, [1, 4, 2]);
  });

  it('returns empty array for empty document list', async () => {
    installMockReranker(factory);
    const scores = await factory.rerank('query', []);
    assert.deepStrictEqual(scores, []);
  });

  it('issues a single tokenizer call when batch fits', async () => {
    const calls = installMockReranker(factory);
    const docs = ['doc one', 'doc two', 'doc three'];
    await factory.rerank('q', docs);
    assert.strictEqual(calls.length, 1, 'expected exactly one tokenizer call');
    assert.deepStrictEqual(calls[0].queries, ['q', 'q', 'q']);
    assert.deepStrictEqual(calls[0].docs, docs);
  });

  it('chunks across multiple batches when RERANKER_BATCH_SIZE is exceeded', async () => {
    process.env.RERANKER_BATCH_SIZE = '2';
    try {
      const calls = installMockReranker(factory);
      const docs = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
      const scores = await factory.rerank('q', docs);
      // 5 docs, batch size 2 → 3 batches of sizes 2, 2, 1
      assert.strictEqual(calls.length, 3);
      assert.deepStrictEqual(calls.map((c) => c.docs.length), [2, 2, 1]);
      // Scores must remain in original document order across batch boundaries
      assert.deepStrictEqual(scores, [1, 2, 3, 4, 5]);
    } finally {
      delete process.env.RERANKER_BATCH_SIZE;
    }
  });

  it('handles multi-label logits by taking the first label per pair', async () => {
    // Simulates a 2-class classifier (some cross-encoders emit
    // [not-relevant, relevant] logits). We document that we take the first
    // slot — callers can change the convention by post-processing.
    installMockReranker(factory, { numLabels: 2 });
    const docs = ['a', 'bbb'];
    const scores = await factory.rerank('q', docs);
    assert.deepStrictEqual(scores, [1, 3]);
  });
});
