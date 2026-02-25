/**
 * OpenClaw - Custom Providers
 * Dynamic OpenAI-compatible provider configuration via environment variables.
 * 
 * Format in .env:
 * CUSTOM_PROVIDERS=provider1,provider2
 * PROVIDER1_NAME="Provider Display Name"
 * PROVIDER1_BASE_URL="https://api.provider1.com/v1"
 * PROVIDER1_API_KEY="optional-api-key"
 * PROVIDER1_MODELS="model1,model2,model3" (optional)
 */

import { VendorConfig, VendorProtocol } from './vendors.js';
import { log } from '../utils/logger.js';

export interface CustomProviderConfig extends VendorConfig {
  /** Optional comma-separated list of supported models */
  models?: string[];
}

/**
 * Parse custom providers from environment variables.
 * Looks for CUSTOM_PROVIDERS and associated _NAME, _BASE_URL, _API_KEY, _MODELS variables.
 */
export function loadCustomProviders(): Record<string, CustomProviderConfig> {
  const customProvidersList = process.env.CUSTOM_PROVIDERS;
  
  if (!customProvidersList) {
    return {};
  }

  const prefixes = customProvidersList
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  const providers: Record<string, CustomProviderConfig> = {};

  for (const prefix of prefixes) {
    const config = parseProviderConfig(prefix);
    if (config) {
      providers[prefix] = config;
      log.info(`Custom provider registered: ${config.name} (${prefix})`);
    }
  }

  return providers;
}

/**
 * Parse configuration for a single custom provider prefix.
 */
function parseProviderConfig(prefix: string): CustomProviderConfig | null {
  const envPrefix = prefix.toUpperCase();
  
  const name = process.env[`${envPrefix}_NAME`] || `${prefix} (Custom)`;
  const baseUrl = process.env[`${envPrefix}_BASE_URL`];
  const apiKey = process.env[`${envPrefix}_API_KEY`];
  const modelsStr = process.env[`${envPrefix}_MODELS`];

  if (!baseUrl) {
    log.warn(`Custom provider "${prefix}" missing ${envPrefix}_BASE_URL, skipping`);
    return null;
  }

  // Validate URL format
  try {
    new URL(baseUrl);
  } catch {
    log.warn(`Custom provider "${prefix}" has invalid baseUrl: ${baseUrl}`);
    return null;
  }

  const config: CustomProviderConfig = {
    name,
    prefix,
    baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
    protocol: 'openai' as VendorProtocol,
    requiresKey: !!apiKey,
    envVar: apiKey ? `${envPrefix}_API_KEY` : undefined,
    description: `Custom OpenAI-compatible provider`,
  };

  if (modelsStr) {
    config.models = modelsStr.split(',').map(m => m.trim()).filter(m => m.length > 0);
  }

  return config;
}

/**
 * Get a list of all custom provider prefixes.
 */
export function getCustomProviderPrefixes(): string[] {
  const customProvidersList = process.env.CUSTOM_PROVIDERS;
  if (!customProvidersList) return [];
  
  return customProvidersList
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);
}

/**
 * Check if a prefix is a custom provider.
 */
export function isCustomProvider(prefix: string): boolean {
  return getCustomProviderPrefixes().includes(prefix.toLowerCase());
}

/**
 * Validate all custom provider configurations.
 * Returns a report of valid/invalid providers.
 */
export function validateCustomProviders(): {
  valid: string[];
  invalid: Array<{ prefix: string; reason: string }>;
} {
  const prefixes = getCustomProviderPrefixes();
  const valid: string[] = [];
  const invalid: Array<{ prefix: string; reason: string }> = [];

  for (const prefix of prefixes) {
    const envPrefix = prefix.toUpperCase();
    const baseUrl = process.env[`${envPrefix}_BASE_URL`];

    if (!baseUrl) {
      invalid.push({ prefix, reason: `Missing ${envPrefix}_BASE_URL` });
      continue;
    }

    try {
      new URL(baseUrl);
      valid.push(prefix);
    } catch {
      invalid.push({ prefix, reason: `Invalid URL: ${baseUrl}` });
    }
  }

  return { valid, invalid };
}

/**
 * Get the API key for a custom provider.
 */
export function getCustomProviderApiKey(prefix: string): string | undefined {
  const envPrefix = prefix.toUpperCase();
  return process.env[`${envPrefix}_API_KEY`];
}

/**
 * Build a complete VendorConfig from environment for a custom provider.
 */
export function buildCustomVendorConfig(prefix: string): VendorConfig | null {
  const envPrefix = prefix.toUpperCase();
  
  const name = process.env[`${envPrefix}_NAME`] || `${prefix} (Custom)`;
  const baseUrl = process.env[`${envPrefix}_BASE_URL`];
  const apiKey = process.env[`${envPrefix}_API_KEY`];

  if (!baseUrl) {
    return null;
  }

  try {
    new URL(baseUrl);
  } catch {
    return null;
  }

  return {
    name,
    prefix,
    baseUrl: baseUrl.replace(/\/$/, ''),
    protocol: 'openai' as VendorProtocol,
    requiresKey: !!apiKey,
    envVar: apiKey ? `${envPrefix}_API_KEY` : undefined,
    description: `Custom OpenAI-compatible provider`,
  };
}
