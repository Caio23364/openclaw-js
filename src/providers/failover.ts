/**
 * OpenClaw — Model Failover
 *
 * Automatic retry with fallback models when a provider fails.
 * Supports configurable fallback chains, exponential backoff,
 * and provider health tracking.
 *
 * Failover chain example:
 *   anthropic/claude-3-5-sonnet → openai/gpt-4o → deepseek/deepseek-chat → ollama/llama3
 */

import { log } from '../utils/logger.js';
import { getProviderManager } from '../providers/index.js';
import { getMetrics } from '../metrics/index.js';
import { Message, Tool, ToolCall } from '../types/index.js';

// ── Types ──

export interface FailoverConfig {
    /** Ordered list of models to try (vendor/model format) */
    chain: string[];
    /** Max retries per model before moving to next */
    maxRetries: number;
    /** Base delay between retries in ms */
    retryDelayMs: number;
    /** Timeout per attempt in ms */
    timeoutMs: number;
}

export interface FailoverResult {
    content: string;
    toolCalls?: ToolCall[];
    usage?: { input: number; output: number };
    /** Which model actually succeeded */
    model: string;
    /** How many attempts total */
    attempts: number;
    /** Which models failed */
    failedModels: string[];
    /** Total time including retries */
    totalMs: number;
}

interface ProviderHealth {
    model: string;
    failures: number;
    lastFailure?: Date;
    lastSuccess?: Date;
    /** Temporarily disabled until this time */
    disabledUntil?: Date;
}

// ── Default fallback chains ──

export const DEFAULT_CHAINS: Record<string, string[]> = {
    high: [
        'anthropic/claude-3-5-sonnet-20241022',
        'openai/gpt-4o',
        'google/gemini-1.5-pro',
        'deepseek/deepseek-chat',
    ],
    balanced: [
        'openai/gpt-4o',
        'anthropic/claude-3-5-sonnet-20241022',
        'deepseek/deepseek-chat',
        'google/gemini-1.5-flash',
    ],
    fast: [
        'openai/gpt-4o-mini',
        'anthropic/claude-3-haiku-20240307',
        'google/gemini-1.5-flash',
        'groq/llama-3.1-70b-versatile',
    ],
    local: [
        'ollama/llama3',
        'llamacpp/default',
        'vllm/default',
    ],
};

const DEFAULT_CONFIG: FailoverConfig = {
    chain: DEFAULT_CHAINS.balanced,
    maxRetries: 2,
    retryDelayMs: 1000,
    timeoutMs: 60000,
};

// ── Health tracking ──

const healthMap = new Map<string, ProviderHealth>();

function getHealth(model: string): ProviderHealth {
    if (!healthMap.has(model)) {
        healthMap.set(model, { model, failures: 0 });
    }
    return healthMap.get(model)!;
}

function markFailure(model: string): void {
    const health = getHealth(model);
    health.failures++;
    health.lastFailure = new Date();

    // Circuit breaker: disable for escalating periods
    if (health.failures >= 3) {
        const disableDuration = Math.min(health.failures * 30000, 300000); // 30s–5min
        health.disabledUntil = new Date(Date.now() + disableDuration);
        log.warn(`Model ${model} circuit-breaker: disabled for ${disableDuration / 1000}s (${health.failures} failures)`);
    }
}

function markSuccess(model: string): void {
    const health = getHealth(model);
    health.failures = 0;
    health.lastSuccess = new Date();
    health.disabledUntil = undefined;
}

function isModelAvailable(model: string): boolean {
    const health = getHealth(model);
    if (health.disabledUntil && health.disabledUntil > new Date()) {
        return false;
    }
    return true;
}

// ── Core failover ──

/**
 * Chat with automatic model failover.
 * Tries each model in the chain until one succeeds.
 */
export async function chatWithFailover(
    messages: Message[],
    options: {
        systemPrompt?: string;
        temperature?: number;
        maxTokens?: number;
        tools?: Tool[];
        config?: Partial<FailoverConfig>;
        /** Preferred model — tried first before the chain */
        preferredModel?: string;
    } = {},
): Promise<FailoverResult> {
    const startTime = Date.now();
    const config = { ...DEFAULT_CONFIG, ...options.config };
    const provider = getProviderManager();
    const failedModels: string[] = [];
    let attempts = 0;

    // Build the chain: preferred model first, then the fallback chain
    const chain = options.preferredModel
        ? [options.preferredModel, ...config.chain.filter(m => m !== options.preferredModel)]
        : [...config.chain];

    for (const modelString of chain) {
        // Check circuit breaker
        if (!isModelAvailable(modelString)) {
            log.debug(`Failover: skipping ${modelString} (circuit-breaker active)`);
            failedModels.push(modelString);
            continue;
        }

        for (let retry = 0; retry < config.maxRetries; retry++) {
            attempts++;

            try {
                log.debug(`Failover: trying ${modelString} (attempt ${retry + 1})`);

                // Race against timeout
                const response = await Promise.race([
                    provider.chatWithModel(modelString, messages, {
                        systemPrompt: options.systemPrompt,
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        tools: options.tools,
                    }),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout')), config.timeoutMs)
                    ),
                ]);

                markSuccess(modelString);

                return {
                    content: response.content,
                    toolCalls: response.toolCalls,
                    usage: response.usage,
                    model: modelString,
                    attempts,
                    failedModels,
                    totalMs: Date.now() - startTime,
                };
            } catch (error: any) {
                log.warn(`Failover: ${modelString} failed (attempt ${retry + 1}): ${error.message}`);

                // Exponential backoff before retry
                if (retry < config.maxRetries - 1) {
                    const delay = config.retryDelayMs * Math.pow(2, retry);
                    await sleep(delay);
                }
            }
        }

        // All retries exhausted for this model
        markFailure(modelString);
        failedModels.push(modelString);
    }

    // All models failed
    throw new Error(
        `All models in failover chain exhausted after ${attempts} attempts. ` +
        `Failed: ${failedModels.join(', ')}`,
    );
}

/**
 * Get the health status of all tracked models.
 */
export function getModelHealth(): ProviderHealth[] {
    return Array.from(healthMap.values());
}

/**
 * Reset health tracking for all models.
 */
export function resetModelHealth(): void {
    healthMap.clear();
}

/**
 * Get a failover config from a preset name.
 */
export function getFailoverPreset(name: keyof typeof DEFAULT_CHAINS): FailoverConfig {
    return {
        ...DEFAULT_CONFIG,
        chain: DEFAULT_CHAINS[name] ?? DEFAULT_CHAINS.balanced,
    };
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
