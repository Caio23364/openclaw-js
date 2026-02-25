/**
 * OpenClaw — Streaming & Chunking
 *
 * Handles token-by-token streaming from AI providers to connected clients.
 * Integrates with the gateway event system to emit `agent` events for each
 * token delta, enabling real-time display in native apps and web UIs.
 *
 * Also provides per-channel message chunking: splits long responses into
 * channel-appropriate sizes (e.g., WhatsApp 4096 chars, Telegram 4096,
 * Discord 2000, SMS 160).
 */

import { log } from '../utils/logger.js';
import { getGateway } from '../gateway/index.js';
import { getMetrics } from '../metrics/index.js';
import { getProviderManager } from '../providers/index.js';
import { Message, Tool, ToolCall, Session } from '../types/index.js';

// ── Per-channel message limits ──

export const CHANNEL_LIMITS: Record<string, number> = {
    whatsapp: 4096,
    telegram: 4096,
    discord: 2000,
    slack: 40000,
    signal: 4096,
    matrix: 65536,
    webchat: 65536,
    sms: 160,
    imessage: 20000,
};

const DEFAULT_LIMIT = 4096;

// ── Types ──

export interface StreamResult {
    content: string;
    toolCalls?: ToolCall[];
    usage?: { input: number; output: number };
    chunks: number;
    streamDurationMs: number;
}

export interface StreamOptions {
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    /** Session ID for gateway event emission */
    sessionId?: string;
    /** Channel type for chunking */
    channel?: string;
    /** Callback for each content delta */
    onDelta?: (delta: string) => void;
    /** Callback when streaming completes */
    onDone?: (result: StreamResult) => void;
}

// ── Streaming ──

/**
 * Stream a chat completion, emitting gateway `agent` events for each token.
 * Falls back to non-streaming if the provider doesn't support it.
 */
export async function streamChat(
    providerType: string,
    messages: Message[],
    options: StreamOptions = {},
): Promise<StreamResult> {
    const startTime = Date.now();
    const gateway = getGateway();
    const provider = getProviderManager();

    let fullContent = '';
    let toolCalls: ToolCall[] = [];
    let chunks = 0;

    try {
        // Use the provider's stream generator
        const stream = provider.streamChat(
            providerType as any,
            messages,
            {
                model: options.model,
                systemPrompt: options.systemPrompt,
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                tools: options.tools,
            },
        );

        for await (const chunk of stream) {
            if (chunk.type === 'content') {
                const delta = chunk.data as string;
                fullContent += delta;
                chunks++;

                // Emit gateway event for connected apps
                if (options.sessionId) {
                    gateway.emitAgentEvent(options.sessionId, delta, false);
                }

                // User callback
                if (options.onDelta) {
                    options.onDelta(delta);
                }
            } else if (chunk.type === 'tool_call') {
                toolCalls.push(chunk.data as ToolCall);
            }
        }

        // Emit done event
        if (options.sessionId) {
            gateway.emitAgentEvent(options.sessionId, '', true);
        }
    } catch (error: any) {
        log.warn(`Streaming failed, falling back to non-streaming: ${error.message}`);

        // Fallback to non-streaming
        const response = await provider.chat(
            providerType as any,
            messages,
            {
                model: options.model,
                systemPrompt: options.systemPrompt,
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                tools: options.tools,
            },
        );

        fullContent = response.content;
        toolCalls = response.toolCalls ?? [];
        chunks = 1;

        // Emit the full content at once
        if (options.sessionId) {
            gateway.emitAgentEvent(options.sessionId, fullContent, true);
        }
    }

    const result: StreamResult = {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        chunks,
        streamDurationMs: Date.now() - startTime,
    };

    if (options.onDone) {
        options.onDone(result);
    }

    return result;
}

/**
 * Stream using a model string with vendor prefix (e.g., "deepseek/deepseek-chat").
 */
export async function streamWithModel(
    modelString: string,
    messages: Message[],
    options: StreamOptions = {},
): Promise<StreamResult> {
    const startTime = Date.now();
    const gateway = getGateway();
    const provider = getProviderManager();

    let fullContent = '';
    let toolCalls: ToolCall[] = [];
    let chunks = 0;

    try {
        const stream = provider.streamWithModel(
            modelString,
            messages,
            {
                systemPrompt: options.systemPrompt,
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                tools: options.tools,
            },
        );

        for await (const chunk of stream) {
            if (chunk.type === 'content') {
                const delta = chunk.data as string;
                fullContent += delta;
                chunks++;

                if (options.sessionId) {
                    gateway.emitAgentEvent(options.sessionId, delta, false);
                }
                if (options.onDelta) {
                    options.onDelta(delta);
                }
            } else if (chunk.type === 'tool_call') {
                toolCalls.push(chunk.data as ToolCall);
            }
        }

        if (options.sessionId) {
            gateway.emitAgentEvent(options.sessionId, '', true);
        }
    } catch (error: any) {
        log.warn(`Model streaming failed, fallback: ${error.message}`);

        const response = await provider.chatWithModel(modelString, messages, {
            systemPrompt: options.systemPrompt,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            tools: options.tools,
        });

        fullContent = response.content;
        toolCalls = response.toolCalls ?? [];
        chunks = 1;

        if (options.sessionId) {
            gateway.emitAgentEvent(options.sessionId, fullContent, true);
        }
    }

    return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        chunks,
        streamDurationMs: Date.now() - startTime,
    };
}

// ── Chunking ──

/**
 * Split a long message into channel-appropriate chunks.
 * Respects paragraph boundaries where possible.
 */
export function chunkMessage(content: string, channel: string): string[] {
    const limit = CHANNEL_LIMITS[channel] ?? DEFAULT_LIMIT;

    if (content.length <= limit) {
        return [content];
    }

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
        if (remaining.length <= limit) {
            chunks.push(remaining);
            break;
        }

        // Try to split at paragraph boundary
        let splitIndex = remaining.lastIndexOf('\n\n', limit);
        if (splitIndex < limit * 0.3) {
            // Try single newline
            splitIndex = remaining.lastIndexOf('\n', limit);
        }
        if (splitIndex < limit * 0.3) {
            // Try sentence boundary
            splitIndex = remaining.lastIndexOf('. ', limit);
            if (splitIndex > 0) splitIndex += 1; // include the period
        }
        if (splitIndex < limit * 0.3) {
            // Try space
            splitIndex = remaining.lastIndexOf(' ', limit);
        }
        if (splitIndex < limit * 0.3) {
            // Hard split
            splitIndex = limit;
        }

        chunks.push(remaining.slice(0, splitIndex).trimEnd());
        remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
}

/**
 * Format a chunk with part indicator for multi-part messages.
 */
export function formatChunks(chunks: string[], channel: string): string[] {
    if (chunks.length <= 1) return chunks;

    return chunks.map((chunk, i) => {
        const indicator = `(${i + 1}/${chunks.length})`;
        // Some channels have markdown, some don't
        if (['discord', 'telegram', 'slack', 'matrix', 'webchat'].includes(channel)) {
            return `${chunk}\n\n_${indicator}_`;
        }
        return `${chunk}\n\n${indicator}`;
    });
}
