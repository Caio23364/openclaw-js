/**
 * OpenClaw - Chat Commands
 * Handles slash commands from messaging channels.
 * Compatible with original OpenClaw chat commands.
 *
 * Commands:
 *   /status — session status (model, tokens, cost)
 *   /new, /reset — reset the session
 *   /compact — compact session context (summary)
 *   /think <level> — off|minimal|low|medium|high|xhigh
 *   /verbose on|off
 *   /usage off|tokens|full — per-response usage footer
 *   /restart — restart the gateway (owner-only)
 *   /activation mention|always — group activation toggle
 *   /help — list commands
 */

import { log } from '../utils/logger.js';
import { Session } from '../types/index.js';

// ── Types ──

export interface ChatCommandResult {
    handled: boolean;
    response?: string;
    action?: 'reset' | 'compact' | 'restart' | 'none';
    sessionUpdates?: Partial<SessionSettings>;
}

interface SessionSettings {
    thinkingLevel: string;
    verboseLevel: string;
    sendPolicy: string;
    groupActivation: string;
    usageMode: string;
    model: string;
}

// ── Thinking levels ──

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

// ── Parser ──

/**
 * Parse and handle a chat command.
 * Returns { handled: true, response } if the message was a command.
 * Returns { handled: false } if the message is not a command.
 */
export function parseChatCommand(
    content: string,
    session: Session,
    isOwner: boolean = false,
): ChatCommandResult {
    const trimmed = content.trim();

    // Must start with /
    if (!trimmed.startsWith('/')) {
        return { handled: false };
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts[1]?.toLowerCase();

    switch (command) {
        // ── /status ──
        case '/status': {
            const model = session.settings?.model || 'default';
            const thinking = session.settings?.thinkingLevel || 'medium';
            const tokens = session.tokenCount || 0;
            const cost = session.costTotal || 0;
            const messages = session.messageCount || 0;
            const contextLen = session.context?.length || 0;

            let response = `📊 *Session Status*\n`;
            response += `• Model: \`${model}\`\n`;
            response += `• Thinking: \`${thinking}\`\n`;
            response += `• Messages: ${messages}\n`;
            response += `• Context: ${contextLen} messages\n`;
            response += `• Tokens: ${tokens.toLocaleString()}`;
            if (cost > 0) {
                response += ` (~$${cost.toFixed(4)})`;
            }

            return { handled: true, response, action: 'none' };
        }

        // ── /new, /reset ──
        case '/new':
        case '/reset':
            return {
                handled: true,
                response: '🔄 Session reset.',
                action: 'reset',
            };

        // ── /compact ──
        case '/compact':
            return {
                handled: true,
                response: '📦 Session compacted.',
                action: 'compact',
            };

        // ── /think <level> ──
        case '/think': {
            if (!arg || !THINKING_LEVELS.includes(arg as any)) {
                return {
                    handled: true,
                    response: `💭 Current thinking: \`${session.settings?.thinkingLevel || 'medium'}\`\nOptions: ${THINKING_LEVELS.join(', ')}`,
                    action: 'none',
                };
            }

            return {
                handled: true,
                response: `💭 Thinking level set to: \`${arg}\``,
                action: 'none',
                sessionUpdates: { thinkingLevel: arg },
            };
        }

        // ── /verbose on|off ──
        case '/verbose': {
            if (!arg || !['on', 'off'].includes(arg)) {
                return {
                    handled: true,
                    response: `🔊 Verbose mode: \`${session.settings?.verboseLevel || 'off'}\`\nUsage: /verbose on|off`,
                    action: 'none',
                };
            }

            return {
                handled: true,
                response: `🔊 Verbose mode: \`${arg}\``,
                action: 'none',
                sessionUpdates: { verboseLevel: arg },
            };
        }

        // ── /usage off|tokens|full ──
        case '/usage': {
            const validModes = ['off', 'tokens', 'full'];
            if (!arg || !validModes.includes(arg)) {
                return {
                    handled: true,
                    response: `📈 Usage mode: \`${session.settings?.usageMode || 'off'}\`\nOptions: off, tokens, full`,
                    action: 'none',
                };
            }

            return {
                handled: true,
                response: `📈 Usage mode set to: \`${arg}\``,
                action: 'none',
                sessionUpdates: { usageMode: arg },
            };
        }

        // ── /activation mention|always ──
        case '/activation': {
            if (!arg || !['mention', 'always'].includes(arg)) {
                return {
                    handled: true,
                    response: `📢 Group activation: \`${session.settings?.groupActivation || 'mention'}\`\nOptions: mention, always`,
                    action: 'none',
                };
            }

            return {
                handled: true,
                response: `📢 Group activation set to: \`${arg}\``,
                action: 'none',
                sessionUpdates: { groupActivation: arg },
            };
        }

        // ── /model <model> ──
        case '/model': {
            if (!arg) {
                return {
                    handled: true,
                    response: `🤖 Current model: \`${session.settings?.model || 'default'}\`\nUsage: /model provider/model-name`,
                    action: 'none',
                };
            }

            const modelStr = parts.slice(1).join(' ');
            return {
                handled: true,
                response: `🤖 Model set to: \`${modelStr}\``,
                action: 'none',
                sessionUpdates: { model: modelStr },
            };
        }

        // ── /restart ──
        case '/restart': {
            if (!isOwner) {
                return {
                    handled: true,
                    response: '⛔ Only the owner can restart the gateway.',
                    action: 'none',
                };
            }

            return {
                handled: true,
                response: '🔄 Gateway restarting...',
                action: 'restart',
            };
        }

        // ── /help ──
        case '/help': {
            let response = `🦞 *OpenClaw Commands*\n\n`;
            response += `• \`/status\` — Session status\n`;
            response += `• \`/new\` or \`/reset\` — Reset session\n`;
            response += `• \`/compact\` — Compact session context\n`;
            response += `• \`/think <level>\` — Set thinking (off|minimal|low|medium|high|xhigh)\n`;
            response += `• \`/verbose on|off\` — Toggle verbose mode\n`;
            response += `• \`/usage off|tokens|full\` — Usage footer mode\n`;
            response += `• \`/model <name>\` — Change model\n`;
            response += `• \`/activation mention|always\` — Group activation\n`;
            response += `• \`/restart\` — Restart gateway (owner only)\n`;
            response += `• \`/help\` — This help`;

            return { handled: true, response, action: 'none' };
        }

        // Unknown command
        default:
            return {
                handled: true,
                response: `❓ Unknown command: \`${command}\`\nType \`/help\` for available commands.`,
                action: 'none',
            };
    }
}

/**
 * Check if a message content is a chat command.
 */
export function isChatCommand(content: string): boolean {
    return content.trim().startsWith('/');
}
