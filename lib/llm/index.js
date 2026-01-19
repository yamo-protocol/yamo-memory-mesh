/**
 * LLM Module - LLM client support for yamo-memory-mesh
 * Exports multi-provider LLM client for reflection generation
 */

export { LLMClient } from './client.js';

export default {
  LLMClient: (await import('./client.js')).LLMClient
};
