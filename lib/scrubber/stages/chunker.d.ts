/**
 * Type definitions for chunker.js
 */

export interface ChunkerConfig {
  maxSize?: number;
  [key: string]: any;
}

export class Chunker {
  constructor(config?: ChunkerConfig);
  chunk(content: string): Promise<string[]>;
}
