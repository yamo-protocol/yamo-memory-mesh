/**
 * YAMO LLM Module
 * Large Language Model client abstraction
 */
export { LLMClient } from "./client.js";
/**
 * Self-RefiningExtractor is now implemented as a YAMO skill.
 * Use: skill-self-refining-extractor.md
 *
 * Example:
 *   _kernel_execute({
 *     skill: 'skill-self-refining-extractor.md',
 *     skill_path: 'skills/skill-super.md',
 *     max_iterations: 5
 *   })
 */
export const SELF_REFINING_EXTRACTOR = "skill-self-refining-extractor.md";
