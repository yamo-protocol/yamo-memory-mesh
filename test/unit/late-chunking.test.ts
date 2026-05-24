/**
 * Tests for Late Chunking (Jina, Sep 2024) — full-doc embedding with
 * per-chunk mean-pooling. Validates:
 *
 * - EmbeddingService.embedLateChunked() pooling math + bail conditions
 * - MemoryMesh._splitParagraphSpans() char-offset boundaries
 * - MemoryMesh.addDocument() — late-chunked path (mocked) + per-chunk fallback
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import EmbeddingService from '../../lib/memory/embeddings/service.js';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('EmbeddingService.embedLateChunked', () => {
  it('returns [] for empty spans array', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    const r = await svc.embedLateChunked('hello world', []);
    assert.deepStrictEqual(r, []);
  });

  it('returns null when backend is not local (HF/ONNX-specific path)', async () => {
    const svc: any = new EmbeddingService({ modelName: 'whatever', modelType: 'ollama' });
    svc.initialized = true;
    const r = await svc.embedLateChunked('hello', [{ start: 0, end: 5 }]);
    assert.strictEqual(r, null);
  });

  it('returns null when model output lacks 3D token tensor', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    svc.model = async () => ({
      // 2D (pooled) — should bail
      dims: [1, 4],
      data: new Float32Array([1, 0, 0, 0]),
    });
    const r = await svc.embedLateChunked('text', [{ start: 0, end: 4 }]);
    assert.strictEqual(r, null);
  });

  it('mean-pools token embeddings per span and L2-normalizes', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    // 4 tokens of dim 2: [[1,0], [1,0], [0,1], [0,1]]
    // Token offset map: t0=[0,4], t1=[4,8], t2=[8,12], t3=[12,16]
    svc.model = async () => ({
      dims: [1, 4, 2],
      data: new Float32Array([1, 0, 1, 0, 0, 1, 0, 1]),
    });
    const tokFn: any = () => Promise.resolve({
      offset_mapping: [[0, 4], [4, 8], [8, 12], [12, 16]],
    });
    svc.model.tokenizer = tokFn;
    // Two spans: first 8 chars (tokens 0+1 → [1,0]), last 8 chars (tokens 2+3 → [0,1])
    const r = await svc.embedLateChunked('aaaabbbbccccdddd', [
      { start: 0, end: 8 },
      { start: 8, end: 16 },
    ]);
    assert.ok(r);
    assert.strictEqual(r!.length, 2);
    // Both span vectors should be unit length
    for (const v of r!) {
      const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      assert.ok(Math.abs(mag - 1.0) < 1e-6, `expected unit vector, got mag=${mag}`);
    }
    // First span: pooled [1,0], second: [0,1]
    assert.ok(Math.abs(r![0][0] - 1.0) < 1e-6);
    assert.ok(Math.abs(r![0][1] - 0.0) < 1e-6);
    assert.ok(Math.abs(r![1][0] - 0.0) < 1e-6);
    assert.ok(Math.abs(r![1][1] - 1.0) < 1e-6);
  });

  it('ignores special tokens with [0,0] offsets ([CLS], [SEP], [PAD])', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    // 4 tokens: CLS=[0,0], content tokens [0,4] [4,8], SEP=[0,0]
    svc.model = async () => ({
      dims: [1, 4, 2],
      data: new Float32Array([99, 99, 1, 0, 0, 1, 88, 88]), // CLS and SEP have garbage values
    });
    svc.model.tokenizer = () => Promise.resolve({
      offset_mapping: [[0, 0], [0, 4], [4, 8], [0, 0]],
    });
    const r = await svc.embedLateChunked('aaaabbbb', [{ start: 0, end: 8 }]);
    assert.ok(r);
    // Pool only the 2 content tokens → mean [0.5, 0.5] → normalized [0.707, 0.707]
    const v = r![0];
    assert.ok(Math.abs(v[0] - 0.7071067811865475) < 1e-6, `unexpected v[0]=${v[0]}`);
    assert.ok(Math.abs(v[1] - 0.7071067811865475) < 1e-6, `unexpected v[1]=${v[1]}`);
  });

  it('returns zero vector for span with no matching tokens', async () => {
    const svc: any = new EmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2', modelType: 'local' });
    svc.initialized = true;
    svc.model = async () => ({
      dims: [1, 2, 2],
      data: new Float32Array([1, 0, 0, 1]),
    });
    svc.model.tokenizer = () => Promise.resolve({
      offset_mapping: [[0, 4], [4, 8]],
    });
    // Span 100-200 has no tokens in that range
    const r = await svc.embedLateChunked('aaaabbbb', [{ start: 100, end: 200 }]);
    assert.deepStrictEqual(r, [[0, 0]]);
  });
});

describe('MemoryMesh._splitParagraphSpans', () => {
  const mesh: any = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });

  it('returns single span when content fits under maxChars', () => {
    const spans = mesh._splitParagraphSpans('short text', 100, 1000);
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(spans[0].start, 0);
    assert.strictEqual(spans[0].end, 10);
  });

  it('splits on \\n\\n boundaries when chunk reaches minChars', () => {
    const text = 'A'.repeat(150) + '\n\n' + 'B'.repeat(150) + '\n\n' + 'C'.repeat(150);
    const spans = mesh._splitParagraphSpans(text, 100, 200);
    // Each paragraph is 150 chars, above min, total > max → split per paragraph
    assert.strictEqual(spans.length, 3);
    assert.strictEqual(spans[0].start, 0);
    assert.strictEqual(spans[0].end, 152); // 150 + "\n\n"
  });

  it('merges short paragraphs to honor minChars', () => {
    const text = 'short\n\nshort\n\nshort\n\n' + 'X'.repeat(500);
    const spans = mesh._splitParagraphSpans(text, 100, 1000);
    // First 3 are tiny; merged into one chunk with the X-block, or first chunk
    // accumulates until it exceeds min
    assert.ok(spans.length >= 1);
    assert.ok(spans.length <= 2);
  });

  it('covers the full content without gaps', () => {
    const text = 'A'.repeat(200) + '\n\n' + 'B'.repeat(200) + '\n\n' + 'C'.repeat(200);
    const spans = mesh._splitParagraphSpans(text, 100, 250);
    let prevEnd = 0;
    for (const s of spans) {
      assert.ok(s.start <= prevEnd + 5, 'span starts should be contiguous (allowing \\n\\n)');
      prevEnd = s.end;
    }
    assert.strictEqual(prevEnd, text.length);
  });
});

describe('MemoryMesh.addDocument', () => {
  let mesh: any;
  afterEach(async () => {
    if (mesh && mesh.isInitialized) await mesh.close();
  });

  it('short content (≤ maxChunkChars) goes through single-shot add()', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    const r = await mesh.addDocument('short content', {}, { maxChunkChars: 1000 });
    assert.strictEqual(r.chunks, 1);
    assert.strictEqual(r.lateChunked, false);
    assert.strictEqual(r.ids.length, 1);
  });

  it('falls back to per-chunk embed() when embedLateChunked returns null', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    // Default MiniLM doesn't expose token offsets the way our impl expects,
    // so embedLateChunked returns null and we fall back to per-chunk.
    const text = 'A'.repeat(300) + '\n\n' + 'B'.repeat(300) + '\n\n' + 'C'.repeat(300);
    const r = await mesh.addDocument(text, { type: 'doc' }, {
      minChunkChars: 100,
      maxChunkChars: 400,
    });
    assert.ok(r.chunks >= 2, `expected ≥2 chunks, got ${r.chunks}`);
    assert.strictEqual(r.lateChunked, false);
    assert.strictEqual(r.ids.length, r.chunks);
    // Verify the chunks landed with document_id linkage
    const first = await mesh.get(r.ids[0]);
    assert.ok(first);
    const meta = typeof first!.metadata === 'string' ? JSON.parse(first!.metadata) : first!.metadata;
    assert.strictEqual(meta.document_id, r.documentId);
    assert.strictEqual(meta.document_chunk_count, r.chunks);
    assert.strictEqual(meta.document_chunk_index, 0);
    assert.strictEqual(meta.late_chunked, false);
  });

  it('uses Late Chunking path when embedLateChunked returns vectors', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    // Stub the factory to return N fake vectors matching span count
    const stubVectors: number[][] = [];
    mesh.embeddingFactory.embedLateChunked = async (_text: string, spans: any[]) => {
      for (let i = 0; i < spans.length; i++) {
        // Distinct unit vectors so we can tell them apart
        const v = new Array(384).fill(0);
        v[i % 384] = 1;
        stubVectors.push(v);
      }
      return stubVectors;
    };
    const text = 'P1 '.repeat(120) + '\n\n' + 'P2 '.repeat(120) + '\n\n' + 'P3 '.repeat(120);
    const r = await mesh.addDocument(text, { type: 'doc' }, {
      minChunkChars: 100,
      maxChunkChars: 400,
    });
    assert.strictEqual(r.lateChunked, true);
    assert.strictEqual(r.chunks, r.ids.length);
    const first = await mesh.get(r.ids[0]);
    const meta = typeof first!.metadata === 'string' ? JSON.parse(first!.metadata) : first!.metadata;
    assert.strictEqual(meta.late_chunked, true);
    assert.strictEqual(meta.document_id, r.documentId);
    assert.strictEqual(meta.skipDedup, true);
  });

  it('throws on empty content', async () => {
    mesh = new MemoryMesh({ dbDir: ':memory:', enableYamo: false, enableLLM: false });
    await mesh.init();
    await assert.rejects(() => mesh.addDocument(''), /non-empty/i);
  });
});
