/**
 * S-MORA Configuration Loader
 *
 * Loads S-MORA configuration from YAML files and applies environment variable overrides.
 * Implements a flexible configuration system with deep merging and type conversion.
 *
 * @module smora/config/loader
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Convert a string value to its appropriate type
 *
 * Handles boolean, numeric, and string values
 *
 * @param {*} value - Value to convert
 * @returns {*} Converted value
 */
function convertValue(value) {
  // If not a string, return as-is
  if (typeof value !== 'string') {
    return value;
  }

  // Trim whitespace
  const trimmed = value.trim();

  // Handle null/undefined
  if (trimmed === 'null' || trimmed === '') {
    return null;
  }

  // Handle boolean
  if (trimmed.toLowerCase() === 'true') {
    return true;
  }
  if (trimmed.toLowerCase() === 'false') {
    return false;
  }

  // Handle numbers (integer and float)
  if (/^-?\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // Return as string
  return trimmed;
}

/**
 * Check if a value is a plain object (not array, null, etc.)
 *
 * @param {*} item - Item to check
 * @returns {boolean} True if plain object
 */
function isObject(item) {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Deep merge two objects
 *
 * @param {Object} target - Target object
 * @param {Object} source - Source object to merge into target
 * @returns {Object} Merged object
 */
function mergeDeep(target, source) {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = mergeDeep(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

/**
 * Set a value in an object using a dot-notation path
 *
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-notation path (e.g., 'hyde.maxTokens')
 * @param {*} value - Value to set
 */
function setByPath(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || !isObject(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Apply environment variable overrides to configuration
 *
 * Environment variables should be named using SMORA_ prefix and double underscores
 * for nested paths. For example:
 * - SMORA_ENABLED -> enabled
 * - SMORA_HYDE__MAX_TOKENS -> hyde.maxTokens
 * - SMORA_RETRIEVAL__ALPHA -> retrieval.alpha
 *
 * @param {Object} config - Base configuration
 * @returns {Object} Configuration with overrides applied
 */
function applyEnvOverrides(config) {
  const overrides = {};

  // Get all SMORA_ environment variables
  for (const key in process.env) {
    if (key.startsWith('SMORA_')) {
      // Convert env var name to config path
      // SMORA_HYDE__MAX_TOKENS -> hyde.maxTokens
      let path = key
        .substring(6) // Remove 'SMORA_' (6 characters)
        .toLowerCase();

      // Replace double underscores with dots (for nesting)
      // This must be done BEFORE converting to camelCase
      path = path.replace(/__/g, '.');

      // Convert to camelCase (snake_case to camelCase)
      // max_tokens -> maxTokens
      path = path.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

      const value = convertValue(process.env[key]);
      setByPath(overrides, path, value);
    }
  }

  // Merge overrides into config
  return mergeDeep(config, overrides);
}

/**
 * Find the S-MORA configuration file
 *
 * Searches in the following order:
 * 1. SMORA_CONFIG environment variable
 * 2. ./config/smora.yaml
 * 3. ./config/smora.yml
 * 4. /etc/yamo/smora.yaml
 *
 * @returns {string|null} Absolute path to config file, or null if not found
 */
function findConfigFile() {
  // Check environment variable first
  if (process.env.SMORA_CONFIG) {
    const envPath = path.resolve(process.env.SMORA_CONFIG);
    if (fs.existsSync(envPath)) {
      return envPath;
    }
  }

  // Standard locations
  const possiblePaths = [
    path.join(process.cwd(), 'config', 'smora.yaml'),
    path.join(process.cwd(), 'config', 'smora.yml'),
    '/etc/yamo/smora.yaml'
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

/**
 * Load S-MORA configuration from file and environment
 *
 * This is the main entry point for loading S-MORA configuration.
 * It:
 * 1. Loads default configuration
 * 2. Merges with YAML config file (if found)
 * 3. Applies environment variable overrides
 *
 * @param {Object} options - Loading options
 * @param {string} options.configPath - Specific config file path (optional)
 * @param {boolean} options.skipFile - Skip loading file config (default: false)
 * @param {boolean} options.skipEnv - Skip env overrides (default: false)
 * @returns {Promise<Object>} Complete S-MORA configuration
 */
export async function loadSMORAConfig(options = {}) {
  const {
    configPath = null,
    skipFile = false,
    skipEnv = false
  } = options;

  // Import defaults
  const { defaultConfig } = await import('./defaults.js');
  let config = { ...defaultConfig };

  // Load from YAML file
  if (!skipFile) {
    const filePath = configPath || findConfigFile();

    if (filePath && fs.existsSync(filePath)) {
      try {
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const fileConfig = yaml.load(fileContents);

        if (fileConfig && isObject(fileConfig)) {
          config = mergeDeep(config, fileConfig);
        }
      } catch (error) {
        // Log error but continue with defaults
        console.error(`Error loading S-MORA config from ${filePath}:`, error.message);
      }
    }
  }

  // Apply environment variable overrides
  if (!skipEnv) {
    config = applyEnvOverrides(config);
  }

  return config;
}

/**
 * Load S-MORA configuration synchronously (for environments where async is not available)
 *
 * Note: This function uses synchronous file I/O and is provided for compatibility.
 * Prefer loadSMORAConfig() for better performance.
 *
 * @param {Object} options - Loading options
 * @param {string} options.configPath - Specific config file path (optional)
 * @param {boolean} options.skipFile - Skip loading file config (default: false)
 * @param {boolean} options.skipEnv - Skip env overrides (default: false)
 * @returns {Object} Complete S-MORA configuration
 */
export function loadSMORAConfigSync(options = {}) {
  const {
    configPath = null,
    skipFile = false,
    skipEnv = false
  } = options;

  // Cannot use dynamic import in sync context, so we need inline defaults
  const defaultConfig = {
    enabled: false,

    hyde: {
      enabled: false,
      model: 'local',
      maxTokens: 256,
      temperature: 0.3,
      fallbackToQuery: true,
      cacheHypotheticals: true,
      cacheSize: 100
    },

    retrieval: {
      alpha: 0.5,
      vectorLimit: 30,
      keywordLimit: 30,
      finalLimit: 10,
      enableReranking: false,
      enableQualityGate: true,
      minScore: 0.1,
      diversityThreshold: 0.85
    },

    compression: {
      enabled: false,
      maxChunkSize: 500,
      chunkOverlap: 50,
      summaryCompressionRatio: 0.3,
      maxTreeDepth: 3,
      sectionSize: 5,
      cacheTrees: true,
      cacheSize: 100
    },

    assembly: {
      maxTokens: 4000,
      reservedTokens: 512,
      safetyMargin: 100,
      targetUtilization: 0.95,
      structure: 'structured',
      includeCitations: true,
      includeHypothetical: true,
      includeSummary: true,
      instructionTemplate: 'default'
    }
  };

  let config = { ...defaultConfig };

  // Load from YAML file
  if (!skipFile) {
    const filePath = configPath || findConfigFile();

    if (filePath && fs.existsSync(filePath)) {
      try {
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const fileConfig = yaml.load(fileContents);

        if (fileConfig && isObject(fileConfig)) {
          config = mergeDeep(config, fileConfig);
        }
      } catch (error) {
        console.error(`Error loading S-MORA config from ${filePath}:`, error.message);
      }
    }
  }

  // Apply environment variable overrides
  if (!skipEnv) {
    config = applyEnvOverrides(config);
  }

  return config;
}

/**
 * Export utility functions for testing and external use
 */
export {
  convertValue,
  isObject,
  mergeDeep,
  setByPath,
  applyEnvOverrides,
  findConfigFile
};

/**
 * Default export: async config loader
 */
export default loadSMORAConfig;
