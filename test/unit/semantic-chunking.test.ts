import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Chunker } from '../../lib/scrubber/stages/chunker.js';

describe('Semantic Chunking', () => {
  it('should fallback to paragraph chunking when embedFn is absent', async () => {
    const chunker = new Chunker({
      maxTokens: 5,
      minTokens: 1,
      hardMaxTokens: 10,
      splitOnHeadings: true
    });

    const content = "Paragraph one is short.\n\nParagraph two is also short.";
    const chunks = await chunker.chunk(content);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].text, "Paragraph one is short.");
    assert.strictEqual(chunks[1].text, "Paragraph two is also short.");
  });

  it('should chunk semantically when embedFn is provided', async () => {
    // We mock embeddings such that sentence 1 and sentence 2 are very similar,
    // but sentence 2 and sentence 3 are different (low similarity).
    const mockEmbeddings: Record<string, number[]> = {
      "Sentence one is about cats.": [1.0, 0.0, 0.0],
      "Cats are furry animals.": [0.99, 0.0, 0.0], // very similar to sentence 1
      "Rust is a systems programming language.": [0.0, 1.0, 0.0] // different!
    };

    const embedFn = async (text: string) => {
      return mockEmbeddings[text] || [0.0, 0.0, 1.0];
    };

    const chunker = new Chunker({
      maxTokens: 100,
      minTokens: 1,
      hardMaxTokens: 200,
      splitOnHeadings: true,
      embedFn
    });

    const content = "Sentence one is about cats. Cats are furry animals. Rust is a systems programming language.";
    const chunks = await chunker.chunk(content);

    // We expect 2 chunks:
    // Chunk 1: "Sentence one is about cats. Cats are furry animals."
    // Chunk 2: "Rust is a systems programming language."
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].text, "Sentence one is about cats. Cats are furry animals.");
    assert.strictEqual(chunks[1].text, "Rust is a systems programming language.");
  });

  it('should split on headings even when using semantic chunking', async () => {
    const embedFn = async () => [1.0, 0.0, 0.0]; // all same embeddings
    const chunker = new Chunker({
      maxTokens: 100,
      minTokens: 1,
      hardMaxTokens: 200,
      splitOnHeadings: true,
      embedFn
    });

    const content = "# Heading Title\nSome content underneath. # Second Heading\nMore content.";
    const chunks = await chunker.chunk(content);

    assert.strictEqual(chunks.length, 2);
    assert.ok(chunks[0].text.startsWith("# Heading Title"));
    assert.ok(chunks[1].text.startsWith("# Second Heading"));
  });
});
