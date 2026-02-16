/**
 * Type definitions for validator.js
 */

export interface ValidatorConfig {
  strict?: boolean;
  [key: string]: any;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class Validator {
  constructor(config?: ValidatorConfig);
  validate(content: string): Promise<ValidationResult>;
}
