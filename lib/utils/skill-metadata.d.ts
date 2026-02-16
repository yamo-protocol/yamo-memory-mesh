/**
 * Extract identity fields (name, intent, description) from .yamo content.
 *
 * Priority:
 *   1. YAML frontmatter (--- … --- block at file start)
 *   2. Legacy v0.4 root-level compact declarations
 *   3. Content-hash fallback — deterministic and idempotent
 */
export declare function extractSkillIdentity(content: any): {
    name: any;
    intent: any;
    description: any;
};
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
export declare function extractSkillTags(content: any): any;
