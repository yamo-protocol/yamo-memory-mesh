// @ts-nocheck
/**
 * Structured skill-identity extraction.
 *
 * Reads ONLY the YAML frontmatter block (between --- delimiters) or
 * root-level identity declarations in legacy v0.4 compact format.
 * The body of .yamo files is LLM-interpreted and MUST NOT be machine-parsed.
 */
import crypto from "crypto";
/** Fields safe to extract for indexing and display. */
const IDENTITY_FIELDS = new Set(["name", "intent", "description"]);
/** Pre-computed regexes for legacy root-level identity declarations. */
const LEGACY_REGEXES = {
    name: /^name[;:]\s*([^;\n]+);?/m,
    intent: /^intent[;:]\s*([^;\n]+);?/m,
    description: /^description[;:]\s*([^;\n]+);?/m,
};
/**
 * Parse flat key: value or key; value lines from a text block.
 * Only extracts whitelisted identity fields.
 */
function parseFlatBlock(block) {
    const result = {};
    for (const line of block.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const colonIdx = trimmed.indexOf(":");
        const semiIdx = trimmed.indexOf(";");
        let sepIdx;
        if (colonIdx > 0 && semiIdx > 0) {
            sepIdx = Math.min(colonIdx, semiIdx);
        }
        else if (colonIdx > 0) {
            sepIdx = colonIdx;
        }
        else if (semiIdx > 0) {
            sepIdx = semiIdx;
        }
        else {
            continue;
        }
        const key = trimmed.substring(0, sepIdx).trim();
        let value = trimmed.substring(sepIdx + 1).trim();
        // Strip trailing semicolon (legacy compact format)
        if (value.endsWith(";")) {
            value = value.slice(0, -1).trim();
        }
        if (IDENTITY_FIELDS.has(key) && value) {
            result[key] = value;
        }
    }
    return result;
}
/**
 * Extract identity fields (name, intent, description) from .yamo content.
 *
 * Priority:
 *   1. YAML frontmatter (--- … --- block at file start)
 *   2. Legacy v0.4 root-level compact declarations
 *   3. Content-hash fallback — deterministic and idempotent
 */
export function extractSkillIdentity(content) {
    // 1. YAML frontmatter
    if (content.startsWith("---")) {
        const endIdx = content.indexOf("---", 3);
        if (endIdx !== -1) {
            const fields = parseFlatBlock(content.substring(3, endIdx));
            if (fields.name) {
                return {
                    name: fields.name,
                    intent: fields.intent || "general_procedure",
                    description: fields.description || "",
                };
            }
        }
    }
    // 2. Legacy v0.4 root-level identity declarations.
    // Safe: name/intent/description do not appear as body section headers.
    const legacyFields = {};
    for (const field of IDENTITY_FIELDS) {
        const match = content.match(LEGACY_REGEXES[field]);
        if (match) {
            legacyFields[field] = match[1].trim();
        }
    }
    if (legacyFields.name) {
        return {
            name: legacyFields.name,
            intent: legacyFields.intent || "general_procedure",
            description: legacyFields.description || "",
        };
    }
    // 3. Content-hash fallback
    const shortHash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex")
        .substring(0, 12);
    return {
        name: `Unnamed_${shortHash}`,
        intent: "general_procedure",
        description: "",
    };
}
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
export function extractSkillTags(content) {
    // Only parse YAML frontmatter (between --- delimiters)
    if (content.startsWith("---")) {
        const endIdx = content.indexOf("---", 3);
        if (endIdx !== -1) {
            const frontmatter = content.substring(3, endIdx);
            const tagsMatch = frontmatter.match(/^tags:\s*(.+)$/m);
            if (tagsMatch) {
                return tagsMatch[1]
                    .split(",")
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0);
            }
        }
    }
    return [];
}
