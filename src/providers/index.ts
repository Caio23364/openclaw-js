/**
 * OpenClaw - Providers Index
 * Lazy-loaded AI provider integrations (picoclaw-inspired optimization)
 * SDKs are only imported when the provider has an API key configured.
 * Uses the vendor registry for multi-vendor support.
 */

import { Provider, ProviderType, Message, Tool, ToolCall } from '../types/index.js';
import { log } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { 
  VENDOR_REGISTRY, 
  parseModelString, 
  getVendorConfig, 
  type VendorConfig,
  getAllVendorPrefixes,
  getVendorConfigWithCustom,
  getVendorApiKey,
} from './vendors.js';
import { 
  loadCustomProviders, 
  isCustomProvider,
  type CustomProviderConfig 
} from './custom-providers.js';

// Lazy provider type — resolved at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProvider = any;

export interface ProviderManagerConfig {
  [vendor: string]: any;
}

export class ProviderManager {
  private providers: Map<string, AnyProvider>;
  private config: ProviderManagerConfig;

  constructor() {
    this.providers = new Map();
    this.config = {};
  }

  private async loadConfig(): Promise<ProviderManagerConfig> {
    const config = await getConfig();
    return config.providers || {};
  }

  public async initialize(): Promise<void> {
    log.info('Initializing provider manager...');
    this.config = await this.loadConfig();

    // Iterate all vendors in the registry and auto-init if API key is present
    for (const [prefix, vendorConfig] of Object.entries(VENDOR_REGISTRY)) {
      const providerConf = this.config[prefix];
      const apiKey = providerConf?.apiKey || (vendorConfig.envVar ? process.env[vendorConfig.envVar] : undefined);

      if (!apiKey && vendorConfig.requiresKey) {
        continue; // Skip — no key and key is required
      }

      try {
        await this.initializeVendor(prefix, apiKey, providerConf);
      } catch (error) {
        log.error(`Failed to initialize ${vendorConfig.name} provider:`, error);
      }
    }

    // Initialize custom providers from environment
    await this.initializeCustomProviders();

    log.info(`Initialized ${this.providers.size} providers (lazy-loaded)`);
  }

  /**
   * Initialize custom providers defined via CUSTOM_PROVIDERS environment variable.
   */
  private async initializeCustomProviders(): Promise<void> {
    const customProviders = loadCustomProviders();
    
    for (const [prefix, config] of Object.entries(customProviders)) {
      // Skip if already initialized (shouldn't happen, but safety check)
      if (this.providers.has(prefix)) {
        continue;
      }

      const providerConf = this.config[prefix];
      const apiKey = providerConf?.apiKey || getVendorApiKey(prefix);

      if (!apiKey && config.requiresKey) {
        log.warn(`Custom provider "${prefix}" requires API key but none found`);
        continue;
      }

      try {
        const { OpenAIProvider } = await import('./openai.js');
        const provider = new OpenAIProvider({
          apiKey: apiKey || 'dummy',
          baseUrl: providerConf?.baseUrl || config.baseUrl,
          ...providerConf,
        });
        
        // Override display metadata
        provider.id = prefix;
        provider.name = config.name;
        
        this.providers.set(prefix, provider);
        log.info(`Custom provider "${config.name}" initialized (${prefix})`);
      } catch (error) {
        log.error(`Failed to initialize custom provider "${prefix}":`, error);
      }
    }
  }

  /**
   * Initialize a single vendor provider.
   * For OpenAI-compatible vendors, reuses OpenAIProvider with a custom baseUrl.
   */
  private async initializeVendor(
    prefix: string,
    apiKey?: string,
    providerConf?: any
  ): Promise<void> {
    const vendorConfig = getVendorConfig(prefix);
    if (!vendorConfig) {
      log.warn(`Unknown vendor prefix: ${prefix}`);
      return;
    }

    const baseUrl = providerConf?.baseUrl || vendorConfig.baseUrl;

    switch (vendorConfig.protocol) {
      case 'anthropic': {
        const { AnthropicProvider } = await import('./anthropic.js');
        const provider = new AnthropicProvider({
          apiKey: apiKey || '',
          baseUrl,
          ...providerConf,
        });
        this.providers.set(prefix, provider);
        log.info(`${vendorConfig.name} provider initialized (lazy-loaded)`);
        break;
      }

      case 'google': {
        // Only init native Google provider if prefix is 'google' (not 'gemini')
        if (prefix === 'google') {
          const { GoogleProvider } = await import('./google.js');
          const provider = new GoogleProvider({
            apiKey: apiKey || '',
            ...providerConf,
          });
          this.providers.set(prefix, provider);
          log.info(`${vendorConfig.name} provider initialized (lazy-loaded)`);
        }
        break;
      }

      case 'openai':
      default: {
        // All OpenAI-compatible vendors share the same OpenAI SDK
        const { OpenAIProvider } = await import('./openai.js');
        const provider = new OpenAIProvider({
          apiKey: apiKey || 'dummy', // Local providers (ollama, vllm) don't need real keys
          baseUrl,
          ...providerConf,
        });
        // Override display metadata
        provider.id = prefix;
        provider.name = vendorConfig.name;
        this.providers.set(prefix, provider);
        log.info(`${vendorConfig.name} provider initialized (lazy-loaded, OpenAI-compatible)`);
        break;
      }
    }
  }

  public async addProvider(type: ProviderType, config: any): Promise<AnyProvider> {
    const vendorConfig = getVendorConfig(type);

    if (vendorConfig) {
      await this.initializeVendor(type, config.apiKey, config);
      return this.providers.get(type);
    }

    // Check if it's a custom provider
    if (isCustomProvider(type)) {
      const customConfig = getVendorConfigWithCustom(type);
      if (customConfig) {
        const { OpenAIProvider } = await import('./openai.js');
        const provider = new OpenAIProvider({
          apiKey: config.apiKey || getVendorApiKey(type) || 'dummy',
          baseUrl: config.baseUrl || customConfig.baseUrl,
          ...config,
        });
        provider.id = type;
        provider.name = customConfig.name;
        this.providers.set(type, provider);
        log.info(`Custom provider "${type}" added dynamically`);
        return provider;
      }
    }

    // Fallback for unknown types — try OpenAI-compatible
    const { OpenAIProvider } = await import('./openai.js');
    const provider = new OpenAIProvider(config);
    this.providers.set(type, provider);
    return provider;
  }

  public getProvider(type: ProviderType): AnyProvider | undefined {
    return this.providers.get(type);
  }

  public getDefaultProvider(): AnyProvider | undefined {
    // Prioritized fallback chain
    const priority = ['anthropic', 'openai', 'google', 'deepseek', 'groq', 'openrouter', 'ollama'];
    for (const p of priority) {
      const provider = this.providers.get(p);
      if (provider) return provider;
    }
    // Return first available
    const first = this.providers.values().next();
    return first.done ? undefined : first.value;
  }

  public getAllProviders(): AnyProvider[] {
    return Array.from(this.providers.values());
  }

  public getAvailableModels(): { provider: string; models: any[] }[] {
    return Array.from(this.providers.entries()).map(([type, provider]) => ({
      provider: type,
      models: provider.models || [],
    }));
  }

  /**
   * Chat using a model string with vendor prefix.
   * E.g., "deepseek/deepseek-chat", "groq/llama-3.1-70b-versatile", "gpt-4o"
   * Also supports custom providers: "myprovider/model-name"
   */
  public async chatWithModel(
    modelString: string,
    messages: Message[],
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: Tool[];
      stream?: boolean;
    } = {}
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: { input: number; output: number } }> {
    log.info(`[ProviderManager] chatWithModel called with: ${modelString}`);
    const { vendor, model } = parseModelString(modelString);
    log.info(`[ProviderManager] Parsed - vendor: ${vendor}, model: ${model}`);

    let provider = this.providers.get(vendor);

    // Auto-initialize if vendor exists in registry but not yet loaded
    if (!provider) {
      const vendorConfig = getVendorConfig(vendor);
      if (vendorConfig) {
        const apiKey = vendorConfig.envVar ? process.env[vendorConfig.envVar] : undefined;
        if (apiKey || !vendorConfig.requiresKey) {
          await this.initializeVendor(vendor, apiKey);
          provider = this.providers.get(vendor);
        }
      }
    }

    // Try to auto-initialize custom provider
    if (!provider && isCustomProvider(vendor)) {
      const customConfig = getVendorConfigWithCustom(vendor);
      if (customConfig) {
        const apiKey = getVendorApiKey(vendor);
        if (apiKey || !customConfig.requiresKey) {
          try {
            const { OpenAIProvider } = await import('./openai.js');
            const newProvider = new OpenAIProvider({
              apiKey: apiKey || 'dummy',
              baseUrl: customConfig.baseUrl,
              timeout: 60000,
              maxRetries: 3,
              rateLimit: { requestsPerMinute: 100, tokensPerMinute: 100000, concurrentRequests: 10 },
            });
            newProvider.id = vendor;
            newProvider.name = customConfig.name;
            this.providers.set(vendor, newProvider);
            provider = newProvider;
            log.info(`Auto-initialized custom provider: ${customConfig.name}`);
          } catch (error) {
            log.error(`Failed to auto-initialize custom provider "${vendor}":`, error);
          }
        }
      }
    }

    if (!provider) {
      throw new Error(`Provider not found for vendor "${vendor}". Configure an API key or use a supported vendor prefix.`);
    }

    return provider.chat(messages, { ...options, model });
  }

  /**
   * Stream chat using a model string with vendor prefix.
   * Also supports custom providers.
   */
  public async *streamWithModel(
    modelString: string,
    messages: Message[],
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: Tool[];
    } = {}
  ): AsyncGenerator<{ type: 'content' | 'tool_call'; data: string | ToolCall }> {
    const { vendor, model } = parseModelString(modelString);

    let provider = this.providers.get(vendor);

    // Auto-initialize custom provider if needed
    if (!provider && isCustomProvider(vendor)) {
      const customConfig = getVendorConfigWithCustom(vendor);
      if (customConfig) {
        const apiKey = getVendorApiKey(vendor);
        if (apiKey || !customConfig.requiresKey) {
          try {
            const { OpenAIProvider } = await import('./openai.js');
            const newProvider = new OpenAIProvider({
              apiKey: apiKey || 'dummy',
              baseUrl: customConfig.baseUrl,
              timeout: 60000,
              maxRetries: 3,
              rateLimit: { requestsPerMinute: 100, tokensPerMinute: 100000, concurrentRequests: 10 },
            });
            newProvider.id = vendor;
            newProvider.name = customConfig.name;
            this.providers.set(vendor, newProvider);
            provider = newProvider;
            log.info(`Auto-initialized custom provider for streaming: ${customConfig.name}`);
          } catch (error) {
            log.error(`Failed to auto-initialize custom provider "${vendor}":`, error);
          }
        }
      }
    }

    if (!provider) {
      throw new Error(`Provider not found for vendor "${vendor}".`);
    }

    yield* provider.streamChat(messages, { ...options, model });
  }

  public async chat(
    providerType: ProviderType,
    messages: Message[],
    options: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: Tool[];
      stream?: boolean;
    } = {}
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: { input: number; output: number } }> {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Provider not found: ${providerType}`);
    }

    return provider.chat(messages, options);
  }

  public async *streamChat(
    providerType: ProviderType,
    messages: Message[],
    options: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: Tool[];
    } = {}
  ): AsyncGenerator<{ type: 'content' | 'tool_call'; data: string | ToolCall }> {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Provider not found: ${providerType}`);
    }

    yield* provider.streamChat(messages, options);
  }

  public async checkAvailability(): Promise<Record<string, boolean>> {
    const entries = Array.from(this.providers.entries());
    const results = await Promise.allSettled(
      entries.map(([, provider]) => provider.checkAvailability())
    );

    const availability: Record<string, boolean> = {};
    entries.forEach(([type], i) => {
      const result = results[i];
      availability[type] = result.status === 'fulfilled' ? result.value : false;
    });
    return availability;
  }

  public getStatus(): Record<string, any> {
    const status: Record<string, any> = {};
    for (const [type, provider] of this.providers) {
      const vendorConfig = getVendorConfig(type);
      const customConfig = isCustomProvider(type) ? getVendorConfigWithCustom(type) : null;
      
      status[type] = {
        name: vendorConfig?.name || customConfig?.name || type,
        available: provider.status?.available ?? true,
        lastChecked: provider.status?.lastChecked,
        error: provider.status?.error,
        protocol: vendorConfig?.protocol || customConfig?.protocol || 'openai',
        isCustom: !!customConfig,
      };
    }
    return status;
  }

  /**
   * Get a summary of all registered vendors (loaded or not).
   * Includes both built-in and custom providers.
   */
  public getVendorSummary(): { prefix: string; name: string; loaded: boolean; requiresKey: boolean; isCustom: boolean }[] {
    const builtIn = Object.entries(VENDOR_REGISTRY).map(([prefix, config]) => ({
      prefix,
      name: config.name,
      loaded: this.providers.has(prefix),
      requiresKey: config.requiresKey,
      isCustom: false,
    }));

    const customProviders = loadCustomProviders();
    const custom = Object.entries(customProviders).map(([prefix, config]) => ({
      prefix,
      name: config.name,
      loaded: this.providers.has(prefix),
      requiresKey: config.requiresKey,
      isCustom: true,
    }));

    return [...builtIn, ...custom];
  }
}

// Singleton instance
let providerManager: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!providerManager) {
    throw new Error('ProviderManager not initialized. Call createProviderManager() first.');
  }
  return providerManager;
}

export async function createProviderManager(): Promise<ProviderManager> {
  providerManager = new ProviderManager();
  await providerManager.initialize();
  return providerManager;
}

export { 
  VENDOR_REGISTRY, 
  parseModelString, 
  getVendorConfig,
  getAllVendorPrefixes,
  getVendorConfigWithCustom,
  getVendorApiKey,
} from './vendors.js';
export { 
  loadCustomProviders, 
  isCustomProvider,
  validateCustomProviders,
  type CustomProviderConfig,
} from './custom-providers.js';

export default ProviderManager;
