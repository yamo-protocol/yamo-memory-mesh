/**
 * YAMO LLM Module
 * Large Language Model client abstraction
 */
export { LLMClient } from "./client.js";
/**
 * Self-RefiningExtractor is now implemented as a YAMO skill.
 * Use: skill-self-refining-extractor.yamo
 *
 * Example:
 *   _kernel_execute({
 *     skill: 'skill-self-refining-extractor.yamo',
 *     skill_path: 'skills/skill-super.yamo',
 *     max_iterations: 5
 *   })
 */
export const SELF_REFINING_EXTRACTOR = "skill-self-refining-extractor.yamo";
