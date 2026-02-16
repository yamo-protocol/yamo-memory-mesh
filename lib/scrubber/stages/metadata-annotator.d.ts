/**
 * Type definitions for metadata-annotator.js
 */

export interface AnnotatorConfig {
  includeTimestamp?: boolean;
  [key: string]: any;
}

export interface AnnotatedData {
  content: string;
  metadata: Record<string, any>;
}

export class MetadataAnnotator {
  constructor(config?: AnnotatorConfig);
  annotate(content: string): Promise<AnnotatedData>;
}
