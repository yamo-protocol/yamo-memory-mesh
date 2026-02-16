/**
 * Type definitions for structural-cleaner.js
 */

export interface CleanConfig {
  preserveStructure?: boolean;
  [key: string]: any;
}

export class StructuralCleaner {
  constructor(config?: CleanConfig);
  clean(content: string): Promise<string>;
}
