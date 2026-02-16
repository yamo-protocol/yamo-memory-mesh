/**
 * Type definitions for normalizer.js
 */

export interface NormalizerConfig {
  lowercase?: boolean;
  [key: string]: any;
}

export class Normalizer {
  constructor(config?: NormalizerConfig);
  normalize(content: string): Promise<string>;
}
