/**
 * Unit tests for semantic injection in MemoryMesh.add() (Phase 5, Step 1)
 *
 * Semantic injection prepends V5 metadata fields (topics, entities) to the
 * content string before embedding, so the vector space clusters around
 * explicit semantic signals rather than raw content alone.
 */
import { describe, it, expect, vi } from "vitest";
import { MemoryMesh } from "../../lib/memory/memory-mesh.js";

/** Capture the text passed to embeddingFactory.embed() */
function makeTrackedMesh(options: Record<string, unknown> = {}): {
  mesh: MemoryMesh;
  embedSpy: ReturnType<typeof vi.fn>;
} {
  const embedSpy = vi.fn().mockResolvedValue(new Array(384).fill(0.1));

  const mesh = new MemoryMesh({ enableLLM: false, enableYamo: false, ...options });

  // Stub out DB/scrubber/dedup so only the embedding text matters
  (mesh as any).isInitialized = true;
  (mesh as any).client = {
    search: vi.fn().mockResolvedValue([]), // no dedup match
    add: vi.fn().mockResolvedValue({ id: "test-id" }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  (mesh as any).embeddingFactory = {
    configured: true,
    embed: embedSpy,
  };
  (mesh as any).scrubber = {
    process: vi.fn().mockResolvedValue({ success: false, chunks: [] }),
  };

  return { mesh, embedSpy };
}

describe("MemoryMesh — semantic injection", () => {
  it("prepends topics and entities when V5 fields are present", async () => {
    const { mesh, embedSpy } = makeTrackedMesh();

    await mesh.add("Kernel executed a tool call", {
      type: "retain",
      topics: ["kernel", "tool_calling"],
      entities: ["YamoKernel", "WorkflowEngine"],
    });

    expect(embedSpy).toHaveBeenCalledOnce();
    const embeddedText: string = embedSpy.mock.calls[0][0];
    expect(embeddedText).toContain("[TOPICS: kernel, tool_calling]");
    expect(embeddedText).toContain("[ENTITIES: YamoKernel, WorkflowEngine]");
    expect(embeddedText).toContain("Kernel executed a tool call");
  });

  it("does not prepend when metadata has no V5 fields", async () => {
    const { mesh, embedSpy } = makeTrackedMesh();

    await mesh.add("Plain content with no metadata fields", { type: "retain" });

    expect(embedSpy).toHaveBeenCalledOnce();
    const embeddedText: string = embedSpy.mock.calls[0][0];
    expect(embeddedText).toBe("Plain content with no metadata fields");
    expect(embeddedText).not.toContain("[TOPICS:");
    expect(embeddedText).not.toContain("[ENTITIES:");
  });

  it("disables injection when enableSemanticInjection is false", async () => {
    const { mesh, embedSpy } = makeTrackedMesh({ enableSemanticInjection: false });

    await mesh.add("Content that should not be injected", {
      type: "retain",
      topics: ["should", "be", "ignored"],
      entities: ["AlsoIgnored"],
    });

    expect(embedSpy).toHaveBeenCalledOnce();
    const embeddedText: string = embedSpy.mock.calls[0][0];
    expect(embeddedText).toBe("Content that should not be injected");
    expect(embeddedText).not.toContain("[TOPICS:");
  });
});
