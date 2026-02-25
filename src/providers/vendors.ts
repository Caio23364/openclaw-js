/**
 * OpenClaw - Vendor Registry
 * Central registry of all supported AI vendors.
 * Most vendors use the OpenAI-compatible protocol and share the OpenAI provider.
 */

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

export default VENDOR_REGISTRY;
