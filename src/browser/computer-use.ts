/**
 * OpenClaw - Browser Computer-Use Sidecar
 * HTTP client for mouse/keyboard automation via a computer-use sidecar.
 * Supports domain allowlists, coordinate guardrails, and window filtering.
 * Based on ZeroClaw's browser computer-use system.
 */

import { log } from '../utils/logger.js';

// ── Types ──

export interface ComputerUseConfig {
    /** Computer-use sidecar HTTP endpoint */
    endpoint: string;
    /** Per-action timeout in milliseconds */
    timeout_ms: number;
    /** Only allow private/localhost endpoints */
    allow_remote_endpoint: boolean;
    /** Optional window title/process allowlist */
    window_allowlist: string[];
    /** Optional API key for the sidecar */
    api_key?: string;
    /** Max X coordinate guardrail */
    max_coordinate_x: number;
    /** Max Y coordinate guardrail */
    max_coordinate_y: number;
    /** Allowed domains for browser actions */
    allowed_domains: string[];
}

export type ComputerAction =
    | 'mouse_click'
    | 'mouse_double_click'
    | 'mouse_move'
    | 'mouse_drag'
    | 'keyboard_type'
    | 'keyboard_key'
    | 'keyboard_shortcut'
    | 'screenshot'
    | 'scroll'
    | 'wait';

export interface ActionParams {
    x?: number;
    y?: number;
    button?: 'left' | 'right' | 'middle';
    text?: string;
    key?: string;
    keys?: string[];
    direction?: 'up' | 'down' | 'left' | 'right';
    amount?: number;
    duration_ms?: number;
    start_x?: number;
    start_y?: number;
    end_x?: number;
    end_y?: number;
}

export interface ActionResult {
    success: boolean;
    data?: {
        screenshot?: string; // base64 encoded
        text?: string;
        position?: { x: number; y: number };
    };
    error?: string;
    duration_ms?: number;
}

const DEFAULT_CONFIG: ComputerUseConfig = {
    endpoint: 'http://127.0.0.1:8787/v1/actions',
    timeout_ms: 15000,
    allow_remote_endpoint: false,
    window_allowlist: [],
    max_coordinate_x: 3840,
    max_coordinate_y: 2160,
    allowed_domains: [],
};

// ── Validation ──

function isLocalEndpoint(url: string): boolean {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        return (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host.startsWith('192.168.') ||
            host.startsWith('10.') ||
            host.startsWith('172.')
        );
    } catch {
        return false;
    }
}

// ── Computer-Use Client ──

export class ComputerUseClient {
    private config: ComputerUseConfig;
    private sessionId: string;

    constructor(config?: Partial<ComputerUseConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.sessionId = `openclaw-${Date.now()}`;

        // Validate endpoint
        if (!this.config.allow_remote_endpoint && !isLocalEndpoint(this.config.endpoint)) {
            throw new Error(
                `Remote endpoint not allowed: ${this.config.endpoint}. ` +
                `Set browser.computer_use.allow_remote_endpoint = true to allow remote sidecar.`
            );
        }
    }

    /**
     * Execute a computer action via the sidecar.
     */
    async execute(action: ComputerAction, params: ActionParams = {}): Promise<ActionResult> {
        // Validate coordinates
        this.validateCoordinates(params);

        const body = {
            action,
            params,
            policy: {
                allowed_domains: this.config.allowed_domains,
                window_allowlist: this.config.window_allowlist,
                max_coordinate_x: this.config.max_coordinate_x,
                max_coordinate_y: this.config.max_coordinate_y,
            },
            metadata: {
                session_name: this.sessionId,
                source: 'openclaw.browser',
                version: '1.0.0',
            },
        };

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.config.timeout_ms);

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (this.config.api_key) {
                headers['Authorization'] = `Bearer ${this.config.api_key}`;
            }

            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timer);

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Sidecar returned ${response.status}: ${errorText}`,
                };
            }

            const result = (await response.json()) as ActionResult;
            log.info(`Computer action ${action}: ${result.success ? 'success' : 'failed'}`);
            return result;
        } catch (error: any) {
            if (error.name === 'AbortError') {
                return {
                    success: false,
                    error: `Action timed out after ${this.config.timeout_ms}ms`,
                };
            }
            return {
                success: false,
                error: `Failed to execute action: ${error.message}`,
            };
        }
    }

    // ── Convenience methods ──

    async click(x: number, y: number, button: 'left' | 'right' = 'left'): Promise<ActionResult> {
        return this.execute('mouse_click', { x, y, button });
    }

    async doubleClick(x: number, y: number): Promise<ActionResult> {
        return this.execute('mouse_double_click', { x, y, button: 'left' });
    }

    async moveMouse(x: number, y: number): Promise<ActionResult> {
        return this.execute('mouse_move', { x, y });
    }

    async drag(startX: number, startY: number, endX: number, endY: number): Promise<ActionResult> {
        return this.execute('mouse_drag', { start_x: startX, start_y: startY, end_x: endX, end_y: endY });
    }

    async type(text: string): Promise<ActionResult> {
        return this.execute('keyboard_type', { text });
    }

    async pressKey(key: string): Promise<ActionResult> {
        return this.execute('keyboard_key', { key });
    }

    async shortcut(keys: string[]): Promise<ActionResult> {
        return this.execute('keyboard_shortcut', { keys });
    }

    async screenshot(): Promise<ActionResult> {
        return this.execute('screenshot');
    }

    async scroll(direction: 'up' | 'down', amount = 3): Promise<ActionResult> {
        return this.execute('scroll', { direction, amount });
    }

    async wait(durationMs: number): Promise<ActionResult> {
        return this.execute('wait', { duration_ms: durationMs });
    }

    /**
     * Check if the sidecar is healthy.
     */
    async healthCheck(): Promise<boolean> {
        try {
            const healthUrl = this.config.endpoint.replace(/\/actions$/, '/health');
            const response = await fetch(healthUrl, {
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    // ── Validation ──

    private validateCoordinates(params: ActionParams): void {
        const coords = [
            { name: 'x', val: params.x },
            { name: 'start_x', val: params.start_x },
            { name: 'end_x', val: params.end_x },
        ];

        for (const c of coords) {
            if (c.val !== undefined && (c.val < 0 || c.val > this.config.max_coordinate_x)) {
                throw new Error(`Coordinate ${c.name}=${c.val} outside bounds [0, ${this.config.max_coordinate_x}]`);
            }
        }

        const yCoords = [
            { name: 'y', val: params.y },
            { name: 'start_y', val: params.start_y },
            { name: 'end_y', val: params.end_y },
        ];

        for (const c of yCoords) {
            if (c.val !== undefined && (c.val < 0 || c.val > this.config.max_coordinate_y)) {
                throw new Error(`Coordinate ${c.name}=${c.val} outside bounds [0, ${this.config.max_coordinate_y}]`);
            }
        }
    }

    getConfig(): ComputerUseConfig {
        return { ...this.config };
    }
}

// Singleton
let computerUseClient: ComputerUseClient | null = null;

export function getComputerUseClient(): ComputerUseClient {
    if (!computerUseClient) {
        computerUseClient = new ComputerUseClient();
    }
    return computerUseClient;
}

export function createComputerUseClient(config?: Partial<ComputerUseConfig>): ComputerUseClient {
    computerUseClient = new ComputerUseClient(config);
    return computerUseClient;
}

export default ComputerUseClient;
