/**
 * OpenClaw - Configuration Manager
 * Handles loading and validation of configuration
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { config as dotenvConfig } from 'dotenv';
import { GatewayConfig, ChannelConfig, AgentConfig, ProviderConfig } from '../types/index.js';
import { log } from './logger.js';

// Load .env file from project root
dotenvConfig();

export const CONFIG_DIR = join(homedir(), '.openclaw');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const STATE_DIR = join(CONFIG_DIR, 'state');
export const LOGS_DIR = join(CONFIG_DIR, 'logs');
export const SKILLS_DIR = join(CONFIG_DIR, 'skills');
export const WORKSPACE_DIR = join(CONFIG_DIR, 'workspace');

export interface OpenClawConfig {
  gateway: GatewayConfig;
  channels: Record<string, ChannelConfig>;
  agents: Record<string, AgentConfig>;
  providers: Record<string, ProviderConfig>;
  workspaces: Record<string, any>;
  skills: string[];
  users: Record<string, any>;
  /** Security sandbox config */
  sandbox: {
    enabled: boolean;
    workspace: string;
    allowedPaths: string[];
    redactLogs: boolean;
  };
  /** Heartbeat (periodic tasks) config */
  heartbeat: {
    enabled: boolean;
    interval: number;
  };
  /** Identity system: openclaw markdown or AIEOS JSON */
  identity: {
    format: 'openclaw' | 'aieos';
    aieos_path?: string;
    aieos_inline?: string;
  };
  /** Autonomy levels — controls what agents can do */
  autonomy: {
    level: 'readonly' | 'supervised' | 'full';
    workspace_only: boolean;
    allowed_commands: string[];
    forbidden_paths: string[];
    allowed_roots: string[];
  };
  /** Tunnel support for exposing gateway */
  tunnel: {
    provider: 'none' | 'cloudflare' | 'ngrok' | 'tailscale' | 'custom';
    auth_token?: string;
    custom_domain?: string;
    custom_command?: string;
  };
  /** Runtime: native or docker */
  runtime: {
    kind: 'native' | 'docker';
    docker?: {
      image: string;
      network: string;
      memory_limit_mb: number;
      cpu_limit: number;
      read_only_rootfs: boolean;
      mount_workspace: boolean;
    };
  };
  /** Memory system */
  memory: {
    backend: 'sqlite' | 'markdown' | 'none';
    auto_save: boolean;
    vector_weight: number;
    keyword_weight: number;
    embedding_provider: string;
  };
  /** Composio integration */
  composio: {
    enabled: boolean;
    api_key?: string;
    entity_id: string;
  };
  /** Browser computer-use sidecar */
  browser_computer_use: {
    enabled: boolean;
    endpoint: string;
    timeout_ms: number;
    allow_remote_endpoint: boolean;
    allowed_domains: string[];
  };
}

// ── Environment-based channel config ────────────────────────────────
function getTelegramConfigFromEnv(): any {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return undefined;

  const allowedStr = process.env.TELEGRAM_ALLOWED_USERS;
  const allowedUsers = allowedStr
    ? allowedStr.split(',').map(id => id.trim()).filter(id => id.length > 0)
    : [];

  return {
    default: {
      enabled: true,
      botToken,
      dropPendingUpdates: true,
      allowedUsers,
    },
  };
}

// ── Auto-detect AI provider based on available API keys ─────────────
interface DetectedProvider {
  provider: string;
  model: string;
}

function detectProviderFromEnv(): DetectedProvider {
  // Check if AI_MODEL is explicitly provided
  const explicitModel = process.env.AI_MODEL;
  if (explicitModel && explicitModel.trim().length > 0) {
    const modelStr = explicitModel.trim();
    const slashIndex = modelStr.indexOf('/');
    if (slashIndex !== -1) {
      const provider = modelStr.slice(0, slashIndex);
      const model = modelStr.slice(slashIndex + 1);
      log.info(`Auto-detected AI provider: ${provider} (from AI_MODEL)`);
      return { provider, model };
    } else {
      log.info(`Auto-detected AI provider: google (from AI_MODEL without prefix)`);
      return { provider: 'google', model: modelStr };
    }
  }

  log.error('AI_MODEL environment variable must be explicitly defined (e.g., AI_MODEL=google/gemini-2.0-flash)');
  process.exit(1);
}

const detectedProvider = detectProviderFromEnv();

const defaultConfig: OpenClawConfig = {
  gateway: {
    port: 18789,
    host: '127.0.0.1',
    bind: 'loopback',
    auth: {
      mode: 'token',
      token: generateRandomToken(48), // Auto-generated secure token
      jwtSecret: generateRandomToken(32),
      jwtExpiry: 86400 * 7, // 7 days
      allowTailscale: true,
    },
    logging: {
      level: 'info',
      format: 'pretty',
      output: 'console',
      maxSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    },
    cors: {
      enabled: true,
      origins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization'],
    },
    // Security defaults
    originAllowlist: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    maxMessageSize: 1_048_576,       // 1MB max WebSocket message
    maxConnectionsPerIp: 20,         // Rate limit: 20 connections/min/IP
    maxMessagesPerClient: 120,       // Rate limit: 120 messages/min/client
  },
  channels: {
    telegram: getTelegramConfigFromEnv(),
  },
  agents: {
    default: {
      model: detectedProvider.model,
      provider: detectedProvider.provider,
      systemPrompt: 'You are OpenClaw, a helpful AI assistant. You help users with their tasks and answer their questions.',
      temperature: 0.7,
      maxTokens: 4096,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      thinkingLevel: 'medium',
      tools: {
        enabled: ['browser', 'file', 'system'],
        disabled: [],
        requireApproval: ['system.run', 'file.delete'],
      },
      skills: [],
      autoCompact: true,
      compactThreshold: 50,
    },
  },
  providers: {
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      baseUrl: 'https://api.anthropic.com',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        concurrentRequests: 5,
      },
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: 'https://api.openai.com/v1',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        concurrentRequests: 5,
      },
    },
    google: {
      apiKey: process.env.GOOGLE_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        concurrentRequests: 5,
      },
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: 'https://api.deepseek.com/v1',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY || '',
      baseUrl: 'https://api.groq.com/openai/v1',
      timeout: 30000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 30, tokensPerMinute: 50000, concurrentRequests: 3 },
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      baseUrl: 'https://openrouter.ai/api/v1',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    ollama: {
      apiKey: '',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      timeout: 120000,
      maxRetries: 1,
      rateLimit: { requestsPerMinute: 120, tokensPerMinute: 500000, concurrentRequests: 2 },
    },
    zhipu: {
      apiKey: process.env.ZHIPU_API_KEY || '',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    moonshot: {
      apiKey: process.env.MOONSHOT_API_KEY || '',
      baseUrl: 'https://api.moonshot.cn/v1',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    qwen: {
      apiKey: process.env.QWEN_API_KEY || '',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || '',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    vllm: {
      apiKey: '',
      baseUrl: process.env.VLLM_BASE_URL || 'http://localhost:8000/v1',
      timeout: 120000,
      maxRetries: 1,
      rateLimit: { requestsPerMinute: 120, tokensPerMinute: 500000, concurrentRequests: 2 },
    },
    cerebras: {
      apiKey: process.env.CEREBRAS_API_KEY || '',
      baseUrl: 'https://api.cerebras.ai/v1',
      timeout: 30000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    volcengine: {
      apiKey: process.env.VOLCENGINE_API_KEY || '',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    shengsuanyun: {
      apiKey: '',
      baseUrl: 'https://router.shengsuanyun.com/api/v1',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    gemini: {
      apiKey: process.env.GOOGLE_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      timeout: 60000,
      maxRetries: 3,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 5 },
    },
    llamacpp: {
      apiKey: '',
      baseUrl: process.env.LLAMACPP_BASE_URL || 'http://localhost:8080/v1',
      timeout: 120000,
      maxRetries: 1,
      rateLimit: { requestsPerMinute: 120, tokensPerMinute: 500000, concurrentRequests: 2 },
    },
    osaurus: {
      apiKey: '',
      baseUrl: process.env.OSAURUS_BASE_URL || 'http://localhost:1337/v1',
      timeout: 120000,
      maxRetries: 1,
      rateLimit: { requestsPerMinute: 120, tokensPerMinute: 500000, concurrentRequests: 2 },
    },
  },
  workspaces: {
    default: {
      name: 'Default Workspace',
      defaultAgent: 'default',
      defaultModel: 'claude-3-opus-20240229',
      allowedChannels: ['*'],
      allowedSkills: ['*'],
      maxSessions: 100,
      maxTokensPerSession: 100000,
      maxContextTokens: 80000,       // Prevent context explosion
    },
  },
  skills: [],
  users: {},
  sandbox: {
    enabled: true,
    workspace: WORKSPACE_DIR,
    allowedPaths: [],
    redactLogs: true,
  },
  heartbeat: {
    enabled: false,
    interval: 30,
  },
  identity: {
    format: 'openclaw',
  },
  autonomy: {
    level: 'supervised',
    workspace_only: true,
    allowed_commands: ['git', 'npm', 'npx', 'node', 'cargo', 'ls', 'cat', 'grep', 'find', 'echo', 'pwd'],
    forbidden_paths: ['/etc', '/root', '/proc', '/sys', '~/.ssh', '~/.gnupg', '~/.aws'],
    allowed_roots: [],
  },
  tunnel: {
    provider: 'none',
  },
  runtime: {
    kind: 'native',
    docker: {
      image: 'node:20-alpine',
      network: 'none',
      memory_limit_mb: 512,
      cpu_limit: 1.0,
      read_only_rootfs: true,
      mount_workspace: true,
    },
  },
  memory: {
    backend: 'markdown',
    auto_save: true,
    vector_weight: 0.7,
    keyword_weight: 0.3,
    embedding_provider: 'none',
  },
  composio: {
    enabled: false,
    entity_id: 'default',
  },
  browser_computer_use: {
    enabled: false,
    endpoint: 'http://127.0.0.1:8787/v1/actions',
    timeout_ms: 15000,
    allow_remote_endpoint: false,
    allowed_domains: [],
  },
};

/**
 * Generates a cryptographically secure random token.
 * Uses crypto.randomBytes instead of Math.random() for security.
 */
function generateRandomToken(length: number): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

// ── Singleton config cache ──────────────────────────────────────────
let cachedConfig: OpenClawConfig | null = null;

/**
 * Creates required directories using async mkdir with recursive flag.
 * No need for existsSync checks — recursive mkdir is idempotent.
 */
export async function ensureDirectories(): Promise<void> {
  await Promise.all(
    [CONFIG_DIR, STATE_DIR, LOGS_DIR, SKILLS_DIR, WORKSPACE_DIR].map(async (dir) => {
      await mkdir(dir, { recursive: true });
    })
  );
}

/**
 * Updates provider configs with current environment variables.
 * This ensures API keys from .env are always fresh.
 */
function refreshProviderConfigs(config: OpenClawConfig): void {
  // Always use the auto-detected provider for the default agent
  const detected = detectProviderFromEnv();
  log.info(`[Config] Auto-detected provider: ${detected.provider}, model: ${detected.model}`);
  if (config.agents.default) {
    log.info(`[Config] Updating agent from ${config.agents.default.provider} to ${detected.provider}`);
    config.agents.default.provider = detected.provider;
    config.agents.default.model = detected.model;
  } else {
    log.warn('[Config] config.agents.default not found!');
  }

  // Update all provider API keys from environment
  const envMappings: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    groq: 'GROQ_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
    qwen: 'QWEN_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    volcengine: 'VOLCENGINE_API_KEY',
  };

  for (const [provider, envKey] of Object.entries(envMappings)) {
    if (config.providers[provider]) {
      const envValue = process.env[envKey];
      if (envValue && envValue.trim().length > 0) {
        config.providers[provider].apiKey = envValue;
      }
    }
  }
}

/**
 * Loads config from disk and caches it in memory.
 * Subsequent calls return the cached value without disk I/O.
 * Use reloadConfig() to force a re-read from disk.
 */
export async function loadConfig(): Promise<OpenClawConfig> {
  if (cachedConfig) {
    // Even cached config gets refreshed with latest env vars
    refreshProviderConfigs(cachedConfig);
    return cachedConfig;
  }

  await ensureDirectories();

  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const fileConfig = JSON.parse(content);
    const merged: OpenClawConfig = { ...defaultConfig, ...fileConfig };

    // Always refresh providers with current env vars
    refreshProviderConfigs(merged);

    cachedConfig = merged;
    log.info('Configuration loaded successfully');
    return merged;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      log.info('Creating default configuration with secure defaults...');
      log.info(`Auth token auto-generated. Mode: ${defaultConfig.gateway.auth.mode}`);
      log.warn('⚠️  Save your auth token from ~/.openclaw/config.json — it is required for client connections.');
      await saveConfig(defaultConfig);
      cachedConfig = defaultConfig;
      return defaultConfig;
    }
    log.error('Failed to load configuration, using defaults', error);
    cachedConfig = defaultConfig;
    return defaultConfig;
  }
}

/**
 * Saves config to disk asynchronously and updates the cache.
 */
export async function saveConfig(config: OpenClawConfig): Promise<void> {
  try {
    await ensureDirectories();
    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    cachedConfig = config;
    log.info('Configuration saved successfully');
  } catch (error) {
    log.error('Failed to save configuration', error);
    throw error;
  }
}

/**
 * Returns the cached config, loading from disk if not yet cached.
 */
export async function getConfig(): Promise<OpenClawConfig> {
  return loadConfig();
}

/**
 * Forces a reload from disk, bypassing the cache.
 */
export async function reloadConfig(): Promise<OpenClawConfig> {
  cachedConfig = null;
  return loadConfig();
}

/**
 * Merges updates into the current config, saves, and returns it.
 */
export async function updateConfig(updates: Partial<OpenClawConfig>): Promise<OpenClawConfig> {
  const config = await loadConfig();
  const updated = { ...config, ...updates };
  await saveConfig(updated);
  return updated;
}

export async function getGatewayConfig(): Promise<GatewayConfig> {
  return (await loadConfig()).gateway;
}

export async function getChannelConfig(channelId: string): Promise<ChannelConfig | undefined> {
  return (await loadConfig()).channels[channelId];
}

export async function getAgentConfig(agentId: string): Promise<AgentConfig | undefined> {
  return (await loadConfig()).agents[agentId];
}

export async function getProviderConfig(providerId: string): Promise<ProviderConfig | undefined> {
  return (await loadConfig()).providers[providerId];
}

export default {
  loadConfig,
  saveConfig,
  getConfig,
  updateConfig,
  reloadConfig,
  getGatewayConfig,
  getChannelConfig,
  getAgentConfig,
  getProviderConfig,
  ensureDirectories,
  CONFIG_DIR,
  CONFIG_FILE,
  STATE_DIR,
  LOGS_DIR,
  SKILLS_DIR,
  WORKSPACE_DIR,
};
