/**
 * OpenClaw - Composio Integration
 * Connects to composio.dev for 1000+ OAuth app tools.
 * Based on ZeroClaw's composio integration.
 */

import { log } from '../utils/logger.js';

// ── Types ──

export interface ComposioConfig {
    enabled: boolean;
    api_key?: string;
    entity_id: string;
    base_url: string;
}

export interface ComposioAction {
    name: string;
    description: string;
    app: string;
    parameters: Record<string, any>;
}

const DEFAULT_CONFIG: ComposioConfig = {
    enabled: false,
    api_key: process.env.COMPOSIO_API_KEY,
    entity_id: 'default',
    base_url: 'https://backend.composio.dev/api/v2',
};

// ── Composio Client ──

export class ComposioClient {
    private config: ComposioConfig;
    private cachedActions: ComposioAction[] | null = null;

    constructor(config?: Partial<ComposioConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Fetch available actions from Composio.
     */
    async getActions(appName?: string): Promise<ComposioAction[]> {
        if (!this.config.api_key) {
            throw new Error('Composio API key not configured. Set COMPOSIO_API_KEY or composio.api_key in config.');
        }

        try {
            const params = new URLSearchParams();
            if (appName) params.set('appNames', appName);

            const response = await fetch(`${this.config.base_url}/actions?${params}`, {
                headers: {
                    'X-API-Key': this.config.api_key,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Composio API error: ${response.status} ${response.statusText}`);
            }

            const data = (await response.json()) as any;
            this.cachedActions = data.items || [];
            return this.cachedActions!;
        } catch (error) {
            log.error('Failed to fetch Composio actions:', error);
            throw error;
        }
    }

    /**
     * Execute a Composio action.
     */
    async executeAction(
        actionName: string,
        params: Record<string, any>
    ): Promise<any> {
        if (!this.config.api_key) {
            throw new Error('Composio API key not configured');
        }

        try {
            const response = await fetch(`${this.config.base_url}/actions/${actionName}/execute`, {
                method: 'POST',
                headers: {
                    'X-API-Key': this.config.api_key,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    entityId: this.config.entity_id,
                    input: params,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Composio execute failed: ${response.status} — ${errorBody}`);
            }

            return response.json();
        } catch (error) {
            log.error(`Failed to execute Composio action ${actionName}:`, error);
            throw error;
        }
    }

    /**
     * List connected accounts for an app.
     */
    async listAccounts(appName: string): Promise<any[]> {
        if (!this.config.api_key) {
            throw new Error('Composio API key not configured');
        }

        try {
            const response = await fetch(
                `${this.config.base_url}/connectedAccounts?entityId=${this.config.entity_id}`,
                {
                    headers: {
                        'X-API-Key': this.config.api_key,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`Composio API error: ${response.status}`);
            }

            const data = (await response.json()) as any;
            return (data.items || []).filter((a: any) =>
                !appName || a.appName?.toLowerCase() === appName.toLowerCase()
            );
        } catch (error) {
            log.error('Failed to list Composio accounts:', error);
            throw error;
        }
    }

    /**
     * Initiate OAuth connection for an app.
     */
    async initiateConnection(appName: string, redirectUrl?: string): Promise<{ url: string; connectedAccountId: string }> {
        if (!this.config.api_key) {
            throw new Error('Composio API key not configured');
        }

        const response = await fetch(`${this.config.base_url}/connectedAccounts`, {
            method: 'POST',
            headers: {
                'X-API-Key': this.config.api_key,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                entityId: this.config.entity_id,
                appName,
                redirectUrl: redirectUrl || 'https://composio.dev/oauth/callback',
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to initiate connection: ${response.status}`);
        }

        return (await response.json()) as any;
    }

    /**
     * Convert Composio actions to OpenClaw tools format.
     */
    actionsToTools(actions: ComposioAction[]): Array<{ name: string; description: string; parameters: Record<string, any> }> {
        return actions.map((action) => ({
            name: `composio.${action.app}.${action.name}`,
            description: action.description || `Composio: ${action.name}`,
            parameters: action.parameters || {},
        }));
    }

    isEnabled(): boolean {
        return this.config.enabled && !!this.config.api_key;
    }

    getConfig(): ComposioConfig {
        return { ...this.config };
    }
}

// Singleton
let composioClient: ComposioClient | null = null;

export function getComposioClient(): ComposioClient {
    if (!composioClient) {
        composioClient = new ComposioClient();
    }
    return composioClient;
}

export function createComposioClient(config?: Partial<ComposioConfig>): ComposioClient {
    composioClient = new ComposioClient(config);
    return composioClient;
}

export default ComposioClient;
