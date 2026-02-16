/**
 * Structured skill-identity extraction.
 *
 * Reads ONLY the YAML frontmatter block (between --- delimiters) or
 * root-level identity declarations in legacy v0.4 compact format.
 * The body of .yamo files is LLM-interpreted and MUST NOT be machine-parsed.
 */
export interface SkillIdentity {
    name: string;
    intent: string;
    description: string;
}
/**
 * Extract identity fields (name, intent, description) from .yamo content.
 *
 * Priority:
 *   1. YAML frontmatter (--- … --- block at file start)
 *   2. Legacy v0.4 root-level compact declarations
 *   3. Content-hash fallback — deterministic and idempotent
 */
export declare function extractSkillIdentity(content: string): SkillIdentity;
/**
 * Extract tags from YAML frontmatter.
 * Returns an array of tag strings, or empty array if no tags found.
 *
 * Tags are expected in the format:
 *   tags: tag1, tag2, tag3
 *
 * This function ONLY reads the YAML frontmatter block and does NOT parse
 * the skill body, following the same safety constraints as extractSkillIdentity.
 */
export declare function extractSkillTags(content: string): string[];
