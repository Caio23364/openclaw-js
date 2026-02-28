/**
 * OpenClaw - Vendor Registry
 * Central registry of all supported AI vendors.
 * Most vendors use the OpenAI-compatible protocol and share the OpenAI provider.
 * Supports dynamic custom providers via CUSTOM_PROVIDERS env variable.
 */

import { 
  loadCustomProviders, 
  getCustomProviderApiKey,
  buildCustomVendorConfig,
  type CustomProviderConfig 
} from './custom-providers.js';

export type VendorProtocol = 'openai' | 'anthropic' | 'google';

export interface VendorConfig {
    /** Human-readable display name */
    name: string;
    /** Prefix used in model strings (e.g. "deepseek/") */
    prefix: string;
    /** Default API base URL */
    baseUrl: string;
    /** Wire protocol (most use openai-compatible) */
    protocol: VendorProtocol;
    /** Whether an API key is required */
    requiresKey: boolean;
    /** Environment variable name for the API key */
    envVar?: string;
    /** Description for docs/status */
    description?: string;
}

/**
 * All supported vendors.
 * Key = prefix (no trailing slash).
 */
export const VENDOR_REGISTRY: Record<string, VendorConfig> = {
    openai: {
        name: 'OpenAI',
        prefix: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'OPENAI_API_KEY',
        description: 'GPT-4o, GPT-4 Turbo, o1, o3',
    },
    anthropic: {
        name: 'Anthropic',
        prefix: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        protocol: 'anthropic',
        requiresKey: true,
        envVar: 'ANTHROPIC_API_KEY',
        description: 'Claude 3.5 Sonnet, Claude 3 Opus',
    },
    zhipu: {
        name: '智谱 AI (GLM)',
        prefix: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'ZHIPU_API_KEY',
        description: 'GLM-4, GLM-4V',
    },
    deepseek: {
        name: 'DeepSeek',
        prefix: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'DEEPSEEK_API_KEY',
        description: 'DeepSeek-V3, DeepSeek-R1',
    },
    google: {
        name: 'Google Native',
        prefix: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        protocol: 'google',
        requiresKey: true,
        envVar: 'GOOGLE_API_KEY',
        description: 'Native Google Generative AI SDK',
    },
    gemini: {
        name: 'Google Gemini',
        prefix: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'GOOGLE_API_KEY',
        description: 'Gemini 2.0, Gemini 1.5 Pro/Flash',
    },
    groq: {
        name: 'Groq',
        prefix: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'GROQ_API_KEY',
        description: 'LPU inference — Llama, Mixtral, Gemma',
    },
    moonshot: {
        name: 'Moonshot',
        prefix: 'moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'MOONSHOT_API_KEY',
        description: 'Moonshot-v1 (Kimi)',
    },
    qwen: {
        name: '通义千问 (Qwen)',
        prefix: 'qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'QWEN_API_KEY',
        description: 'Qwen-Max, Qwen-Plus, Qwen-Turbo',
    },
    nvidia: {
        name: 'NVIDIA',
        prefix: 'nvidia',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'NVIDIA_API_KEY',
        description: 'NVIDIA NIM — Llama, Mixtral, Nemotron',
    },
    ollama: {
        name: 'Ollama',
        prefix: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        protocol: 'openai',
        requiresKey: false,
        description: 'Local models — Llama, Mistral, Phi, etc.',
    },
    openrouter: {
        name: 'OpenRouter',
        prefix: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'OPENROUTER_API_KEY',
        description: 'Unified gateway to 200+ models',
    },
    vllm: {
        name: 'VLLM',
        prefix: 'vllm',
        baseUrl: 'http://localhost:8000/v1',
        protocol: 'openai',
        requiresKey: false,
        description: 'Self-hosted VLLM inference server',
    },
    cerebras: {
        name: 'Cerebras',
        prefix: 'cerebras',
        baseUrl: 'https://api.cerebras.ai/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'CEREBRAS_API_KEY',
        description: 'Cerebras wafer-scale inference',
    },
    volcengine: {
        name: '火山引擎 (Volcengine)',
        prefix: 'volcengine',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'VOLCENGINE_API_KEY',
        description: 'ByteDance Doubao models',
    },
    kimi: {
        name: 'Kimi Code',
        prefix: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        protocol: 'openai',
        requiresKey: true,
        envVar: 'KIMI_API_KEY',
        description: 'Kimi Code — Advanced coding assistant with reasoning',
    },
    shengsuanyun: {
        name: '神算云 (ShengSuanYun)',
        prefix: 'shengsuanyun',
        baseUrl: 'https://router.shengsuanyun.com/api/v1',
        protocol: 'openai',
        requiresKey: false,
        description: 'ShengSuanYun inference router',
    },
    llamacpp: {
        name: 'llama.cpp',
        prefix: 'llamacpp',
        baseUrl: 'http://localhost:8080/v1',
        protocol: 'openai',
        requiresKey: false,
        description: 'llama-server local inference',
    },
    osaurus: {
        name: 'Osaurus',
        prefix: 'osaurus',
        baseUrl: 'http://localhost:1337/v1',
        protocol: 'openai',
        requiresKey: false,
        description: 'Osaurus MLX edge runtime for macOS',
    },
};

/**
 * Parse a model string like "deepseek/deepseek-chat" into vendor + model.
 * If no prefix, defaults to "openai".
 */
export function parseModelString(modelString: string): { vendor: string; model: string } {
    const slashIndex = modelString.indexOf('/');
    if (slashIndex === -1) {
        return { vendor: 'openai', model: modelString };
    }

    const vendor = modelString.slice(0, slashIndex).toLowerCase();
    const model = modelString.slice(slashIndex + 1);

    if (!VENDOR_REGISTRY[vendor]) {
        // Unknown vendor — treat the whole string as a model on openai
        return { vendor: 'openai', model: modelString };
    }

    return { vendor, model };
}

/**
 * Get vendor configuration by prefix.
 */
export function getVendorConfig(prefix: string): VendorConfig | undefined {
    return VENDOR_REGISTRY[prefix.toLowerCase()];
}

/**
 * Get all registered vendor prefixes.
 */
export function getVendorPrefixes(): string[] {
    return Object.keys(VENDOR_REGISTRY);
}

/**
 * Get all vendors that require an API key.
 */
export function getKeyRequiredVendors(): VendorConfig[] {
    return Object.values(VENDOR_REGISTRY).filter((v) => v.requiresKey);
}

/**
 * Get all local (no-key) vendors.
 */
export function getLocalVendors(): VendorConfig[] {
    return Object.values(VENDOR_REGISTRY).filter((v) => !v.requiresKey);
}

// ============================================================================
// Custom Provider Support
// ============================================================================

/**
 * Get the merged registry including both built-in and custom providers.
 * Custom providers are loaded dynamically from environment variables.
 */
export function getMergedRegistry(): Record<string, VendorConfig | CustomProviderConfig> {
    const customProviders = loadCustomProviders();
    return { ...VENDOR_REGISTRY, ...customProviders };
}

/**
 * Parse a model string with support for custom providers.
 * E.g., "myprovider/gpt-4" where "myprovider" is a custom provider.
 */
export function parseModelStringWithCustom(modelString: string): { 
    vendor: string; 
    model: string;
    isCustom: boolean;
} {
    const slashIndex = modelString.indexOf('/');
    if (slashIndex === -1) {
        return { vendor: 'openai', model: modelString, isCustom: false };
    }

    const vendor = modelString.slice(0, slashIndex).toLowerCase();
    const model = modelString.slice(slashIndex + 1);

    // Check built-in registry first
    if (VENDOR_REGISTRY[vendor]) {
        return { vendor, model, isCustom: false };
    }

    // Check custom providers
    const customProviders = loadCustomProviders();
    if (customProviders[vendor]) {
        return { vendor, model, isCustom: true };
    }

    // Unknown vendor — treat the whole string as a model on openai
    return { vendor: 'openai', model: modelString, isCustom: false };
}

/**
 * Get vendor configuration by prefix, including custom providers.
 */
export function getVendorConfigWithCustom(prefix: string): VendorConfig | CustomProviderConfig | undefined {
    const upperPrefix = prefix.toLowerCase();
    
    // Check built-in first
    if (VENDOR_REGISTRY[upperPrefix]) {
        return VENDOR_REGISTRY[upperPrefix];
    }
    
    // Check custom providers
    return buildCustomVendorConfig(upperPrefix) || undefined;
}

/**
 * Get all registered vendor prefixes including custom providers.
 */
export function getAllVendorPrefixes(): string[] {
    const customProviders = loadCustomProviders();
    return [...Object.keys(VENDOR_REGISTRY), ...Object.keys(customProviders)];
}

/**
 * Get API key for a vendor (built-in or custom).
 */
export function getVendorApiKey(prefix: string): string | undefined {
    const lowerPrefix = prefix.toLowerCase();
    
    // Check built-in vendor
    const builtIn = VENDOR_REGISTRY[lowerPrefix];
    if (builtIn?.envVar) {
        return process.env[builtIn.envVar];
    }
    
    // Check custom provider
    return getCustomProviderApiKey(lowerPrefix);
}

export default VENDOR_REGISTRY;
export { loadCustomProviders, getCustomProviderApiKey };
