/**
 * Prompt Security Utilities — RFC-0010-A
 *
 * Shared sanitisation functions for all LLM prompt construction.
 *
 * Rule (RFC-0010-A §5): Any string originating from user input, memory retrieval,
 * or execution logs that is interpolated into an LLM prompt MUST pass through
 * sanitizePromptField() before interpolation.
 *
 * Audit sweep (2026-03-14):
 *   - lib/memory/memory-mesh.ts   — HyDE query expansion uses `scrubbed` (pre-sanitised)
 *   - lib/memory/memory-mesh.ts   — synthesis prompt uses `scrubbed` (pre-sanitised)
 *   - lib/llm/client.ts           — reflection prompt: static system + formatted memory list
 *   - lib/memory/memory-translator.ts — role-confusion protection already applied
 */

/**
 * Sanitise a free-text value before injecting it into an LLM prompt.
 *
 * Actions:
 *   - Collapses \r\n and \n to a single space (prevents instruction-injection via newlines)
 *   - Escapes double-quotes → \" (prevents breaking out of JSON-encoded fields)
 *   - Caps at maxLen characters (prevents token-budget exhaustion)
 */
export function sanitizePromptField(value: string, maxLen = 256): string {
  if (!value) return "";
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, '\\"')
    .slice(0, maxLen);
}

/**
 * Sanitise a memory or agent identifier before injecting it into an LLM prompt.
 *
 * Allows only alphanumeric characters, underscores, and hyphens.
 * Strips everything else to prevent SQL-style keywords, path traversal, or quote
 * characters from appearing in the prompt even if the ID was tampered with in storage.
 */
export function sanitizeSkillId(value: string, maxLen = 64): string {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, maxLen);
}
