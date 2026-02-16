/**
 * Type definitions for semantic-filter.js
 */

export interface FilterConfig {
  threshold?: number;
  [key: string]: any;
}

export class SemanticFilter {
  constructor(config?: FilterConfig);
  filter(content: string): Promise<string>;
}
