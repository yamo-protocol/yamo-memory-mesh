// @ts-nocheck
/**
 * YAMO Emitter - Constructs structured YAMO ABNF blocks for auditability
 *
 * Based on YAMO Protocol RFC-0011 §3.2 (ABNF colon-separated multi-line format).
 * This format is DISTINCT from the flat wire format (RFC-0008 / RFC-0014).
 *
 * Escaping: RFC-0014 — semicolons in values are percent-encoded as `%3B`.
 * (Supersedes the comma-escape scheme used prior to 2026-03-14.)
 *
 * Reference: yamo-os lib/yamo/emitter.ts (canonical implementation)
 */

/** Percent-encode semicolons in a value so they don't break the YAMO line format. */
function escapeValue(value: string): string {
  return String(value).replace(/;/g, "%3B");
}
/**
 * YamoEmitter class for building YAMO protocol blocks
 * YAMO (Yet Another Multi-agent Orchestration) blocks provide
 * structured reasoning traces for AI agent operations.
 */
export class YamoEmitter {
    /**
     * Build a YAMO block for reflect operation
     * Reflect operations synthesize insights from existing memories
     */
    static buildReflectBlock(params) {
        const { topic, memoryCount, agentId = "default", reflection, confidence = 0.8, } = params;
        const timestamp = new Date().toISOString();
        return `agent: MemoryMesh_${escapeValue(agentId)};
intent: synthesize_insights_from_context;
context:
  topic;${escapeValue(topic || "general")};
  memory_count;${memoryCount};
  timestamp;${timestamp};
constraints:
  hypothesis;Reflection generates new insights from existing facts;
priority: high;
output:
  reflection;${escapeValue(reflection)};
  confidence;${confidence};
meta:
  rationale;Synthesized from ${memoryCount} relevant memories;
  observation;High-level belief formed from pattern recognition;
  confidence;${confidence};
log: reflection_generated;timestamp;${timestamp};memories;${memoryCount};
handoff: End;
`;
    }
    /**
     * Build a YAMO block for retain (add) operation
     * Retain operations store new memories into the system
     */
    static buildRetainBlock(params) {
        const { content, metadata: _metadata = {}, id, agentId = "default", memoryType = "event", } = params;
        const timestamp = new Date().toISOString();
        const contentPreview = content.length > 100 ? `${content.substring(0, 100)}...` : content;
        // RFC-0014: percent-encode semicolons (replaces legacy comma-escape)
        const escapedContent = escapeValue(contentPreview);
        return `agent: MemoryMesh_${escapeValue(agentId)};
intent: store_memory_for_future_retrieval;
context:
  memory_id;${escapeValue(id)};
  memory_type;${escapeValue(memoryType)};
  timestamp;${timestamp};
  content_length;${content.length};
constraints:
  hypothesis;New information should be integrated into world model;
priority: medium;
output:
  memory_stored;${escapeValue(id)};
  content_preview;${escapedContent};
meta:
  rationale;Memory persisted for semantic search and retrieval;
  observation;Content vectorized and stored in LanceDB;
  confidence;1.0;
log: memory_retained;timestamp;${timestamp};id;${escapeValue(id)};type;${escapeValue(memoryType)};
handoff: End;
`;
    }
    /**
     * Build a YAMO block for recall (search) operation
     * Recall operations retrieve memories based on semantic similarity
     */
    static buildRecallBlock(params) {
        const { query, resultCount, limit = 10, agentId = "default", searchType = "semantic", } = params;
        const timestamp = new Date().toISOString();
        const recallRatio = resultCount > 0 ? (resultCount / limit).toFixed(2) : "0.00";
        return `agent: MemoryMesh_${escapeValue(agentId)};
intent: retrieve_relevant_memories;
context:
  query;${escapeValue(query)};
  search_type;${escapeValue(searchType)};
  requested_limit;${limit};
  timestamp;${timestamp};
constraints:
  hypothesis;Relevant memories retrieved based on query;
priority: high;
output:
  results_count;${resultCount};
  recall_ratio;${recallRatio};
meta:
  rationale;Semantic search finds similar content by vector similarity;
  observation;${resultCount} memories found matching query;
  confidence;${resultCount > 0 ? "0.9" : "0.5"};
log: memory_recalled;timestamp;${timestamp};results;${resultCount};query;${escapeValue(query)};
handoff: End;
`;
    }
    /**
     * Build a YAMO block for delete operation (optional)
     * Delete operations remove memories from the system
     */
    static buildDeleteBlock(params) {
        const { id, agentId = "default", reason = "user_request" } = params;
        const timestamp = new Date().toISOString();
        return `agent: MemoryMesh_${escapeValue(agentId)};
intent: remove_memory_from_storage;
context:
  memory_id;${escapeValue(id)};
  reason;${escapeValue(reason)};
  timestamp;${timestamp};
constraints:
  hypothesis;Memory removal should be traceable for audit;
priority: low;
output:
  deleted;${escapeValue(id)};
meta:
  rationale;Memory removed from vector store;
  observation;Deletion recorded for provenance;
  confidence;1.0;
log: memory_deleted;timestamp;${timestamp};id;${escapeValue(id)};
handoff: End;
`;
    }
    /**
     * Validate a YAMO block structure
     * Checks for required sections and proper formatting
     */
    static validateBlock(yamoBlock) {
        const errors = [];
        // Check for required sections
        const requiredSections = [
            "agent:",
            "intent:",
            "context:",
            "output:",
            "log:",
        ];
        for (const section of requiredSections) {
            if (!yamoBlock.includes(section)) {
                errors.push(`Missing required section: ${section}`);
            }
        }
        // Check for semicolon termination
        const lines = yamoBlock.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 &&
                !trimmed.startsWith("//") &&
                !trimmed.endsWith(";")) {
                // Allow empty lines and comments
                if (trimmed &&
                    !trimmed.startsWith("agent:") &&
                    !trimmed.startsWith("handoff:") &&
                    !trimmed.endsWith(":")) {
                    errors.push(`Line not semicolon-terminated: ${trimmed.substring(0, 50)}`);
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
}
export default YamoEmitter;
