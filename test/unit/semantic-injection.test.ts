/**
 * Unit tests for semantic injection in MemoryMesh.add() (Phase 5, Step 1)
 *
 * Semantic injection prepends V5 metadata fields (topics, entities) to the
 * content string before embedding, so the vector space clusters around
 * explicit semantic signals rather than raw content alone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryMesh } from "../../lib/memory/memory-mesh.js";

/** Simple mock function that tracks calls */
function createMockFn<T extends (...args: unknown[]) => unknown>(impl: T) {
  const calls: Parameters<T>[] = [];
  const mockFn = (...args: Parameters<T>): ReturnType<T> => {
    calls.push(args);
    return impl(...args) as ReturnType<T>;
  };
  mockFn.calls = calls;
  return mockFn;
}

/** Capture the text passed to embeddingFactory.embed() */
function makeTrackedMesh(options: Record<string, unknown> = {}): {
  mesh: MemoryMesh;
  getEmbeddedTexts: () => string[];
} {
  const embeddedTexts: string[] = [];
  const embedSpy = createMockFn(async () => {
    return new Array(384).fill(0.1);
  });
  // Wrap to capture the first arg
  const trackedEmbed = async (text: string) => {
    embeddedTexts.push(text);
    return embedSpy(text);
  };

  const mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, ...options });

  // Stub out DB/scrubber/dedup so only the embedding text matters
  (mesh as any).isInitialized = true;
  (mesh as any).client = {
    search: async () => [], // no dedup match
    add: async () => ({ id: "test-id" }),
    getAll: async () => [],
  };
  (mesh as any).embeddingFactory = {
    configured: true,
    embed: trackedEmbed,
  };
  (mesh as any).scrubber = {
    process: async () => ({ success: false, chunks: [] }),
  };

  return { mesh, getEmbeddedTexts: () => embeddedTexts };
}

describe("MemoryMesh — semantic injection", () => {
  it("prepends topics and entities when V5 fields are present", async () => {
    const { mesh, getEmbeddedTexts } = makeTrackedMesh();

    await mesh.add("Kernel executed a tool call", {
      type: "retain",
      topics: ["kernel", "tool_calling"],
      entities: ["YamoKernel", "WorkflowEngine"],
    });

    const embeddedTexts = getEmbeddedTexts();
    assert.strictEqual(embeddedTexts.length, 1, "embed should be called once");
    const embeddedText = embeddedTexts[0];
    assert.ok(embeddedText.includes("[TOPICS: kernel, tool_calling]"), "should contain topics");
    assert.ok(embeddedText.includes("[ENTITIES: YamoKernel, WorkflowEngine]"), "should contain entities");
    assert.ok(embeddedText.includes("Kernel executed a tool call"), "should contain original content");
  });

  it("does not prepend when metadata has no V5 fields", async () => {
    const { mesh, getEmbeddedTexts } = makeTrackedMesh();

    await mesh.add("Plain content with no metadata fields", { type: "retain" });

    const embeddedTexts = getEmbeddedTexts();
    assert.strictEqual(embeddedTexts.length, 1, "embed should be called once");
    const embeddedText = embeddedTexts[0];
    assert.strictEqual(embeddedText, "Plain content with no metadata fields", "should be plain content");
    assert.ok(!embeddedText.includes("[TOPICS:"), "should not contain topics marker");
    assert.ok(!embeddedText.includes("[ENTITIES:"), "should not contain entities marker");
  });

  it("disables injection when enableSemanticInjection is false", async () => {
    const { mesh, getEmbeddedTexts } = makeTrackedMesh({ enableSemanticInjection: false });

    await mesh.add("Content that should not be injected", {
      type: "retain",
      topics: ["should", "be", "ignored"],
      entities: ["AlsoIgnored"],
    });

    const embeddedTexts = getEmbeddedTexts();
    assert.strictEqual(embeddedTexts.length, 1, "embed should be called once");
    const embeddedText = embeddedTexts[0];
    assert.strictEqual(embeddedText, "Content that should not be injected", "should be plain content");
    assert.ok(!embeddedText.includes("[TOPICS:"), "should not contain topics marker");
  });
});
