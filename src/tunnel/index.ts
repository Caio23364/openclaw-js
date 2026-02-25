/**
 * OpenClaw - Tunnel System
 * Exposes the gateway via Cloudflare, ngrok, or Tailscale tunnels.
 * Based on ZeroClaw's tunnel support.
 */

import { spawn, ChildProcess } from 'child_process';
import { log } from '../utils/logger.js';

// ── Types ──

export type TunnelProviderType = 'none' | 'cloudflare' | 'ngrok' | 'tailscale' | 'custom';

export interface TunnelConfig {
    provider: TunnelProviderType;
    auth_token?: string;
    custom_domain?: string;
    custom_command?: string;
    port?: number;
}

export interface TunnelStatus {
    running: boolean;
    provider: TunnelProviderType;
    url?: string;
    pid?: number;
}

interface TunnelProvider {
    start(port: number): Promise<string>;
    stop(): Promise<void>;
    status(): TunnelStatus;
}

// ── Cloudflare Tunnel ──

class CloudflareTunnel implements TunnelProvider {
    private process: ChildProcess | null = null;
    private tunnelUrl: string | null = null;

    async start(port: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = ['tunnel', '--url', `http://localhost:${port}`];

            this.process = spawn('cloudflared', args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let output = '';

            this.process.stderr?.on('data', (data: Buffer) => {
                output += data.toString();
                // Cloudflare outputs the URL to stderr
                const urlMatch = output.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
                if (urlMatch && !this.tunnelUrl) {
                    this.tunnelUrl = urlMatch[0];
                    log.info(`Cloudflare tunnel active: ${this.tunnelUrl}`);
                    resolve(this.tunnelUrl);
                }
            });

            this.process.on('error', (error) => {
                reject(new Error(`Failed to start cloudflared: ${error.message}. Install with: brew install cloudflared`));
            });

            this.process.on('exit', (code) => {
                if (!this.tunnelUrl) {
                    reject(new Error(`cloudflared exited with code ${code}`));
                }
                this.process = null;
                this.tunnelUrl = null;
            });

            // Timeout
            setTimeout(() => {
                if (!this.tunnelUrl) {
                    reject(new Error('Cloudflare tunnel timed out after 30s'));
                }
            }, 30000);
        });
    }

    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
            this.tunnelUrl = null;
            log.info('Cloudflare tunnel stopped');
        }
    }

    status(): TunnelStatus {
        return {
            running: !!this.process,
            provider: 'cloudflare',
            url: this.tunnelUrl || undefined,
            pid: this.process?.pid,
        };
    }
}

// ── ngrok Tunnel ──

class NgrokTunnel implements TunnelProvider {
    private process: ChildProcess | null = null;
    private tunnelUrl: string | null = null;
    private authToken?: string;

    constructor(authToken?: string) {
        this.authToken = authToken;
    }

    async start(port: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = ['http', String(port)];
            if (this.authToken) {
                args.unshift('--authtoken', this.authToken);
            }

            this.process = spawn('ngrok', args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            this.process.on('error', (error) => {
                reject(new Error(`Failed to start ngrok: ${error.message}. Install from: https://ngrok.com/download`));
            });

            // ngrok exposes its API on port 4040 — poll for the URL
            const pollUrl = async () => {
                for (let i = 0; i < 15; i++) {
                    try {
                        const response = await fetch('http://127.0.0.1:4040/api/tunnels');
                        const data = (await response.json()) as any;
                        if (data.tunnels?.length > 0) {
                            this.tunnelUrl = data.tunnels[0].public_url;
                            log.info(`ngrok tunnel active: ${this.tunnelUrl}`);
                            resolve(this.tunnelUrl!);
                            return;
                        }
                    } catch {
                        // ngrok not ready yet
                    }
                    await new Promise((r) => setTimeout(r, 2000));
                }
                reject(new Error('ngrok tunnel timed out'));
            };

            pollUrl();
        });
    }

    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
            this.tunnelUrl = null;
            log.info('ngrok tunnel stopped');
        }
    }

    status(): TunnelStatus {
        return {
            running: !!this.process,
            provider: 'ngrok',
            url: this.tunnelUrl || undefined,
            pid: this.process?.pid,
        };
    }
}

// ── Tailscale Tunnel ──

class TailscaleTunnel implements TunnelProvider {
    private process: ChildProcess | null = null;
    private tunnelUrl: string | null = null;

    async start(port: number): Promise<string> {
        return new Promise((resolve, reject) => {
            this.process = spawn('tailscale', ['funnel', String(port)], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let output = '';

            this.process.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
                const urlMatch = output.match(/https:\/\/[^\s]+/);
                if (urlMatch && !this.tunnelUrl) {
                    this.tunnelUrl = urlMatch[0];
                    log.info(`Tailscale funnel active: ${this.tunnelUrl}`);
                    resolve(this.tunnelUrl);
                }
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                output += data.toString();
                const urlMatch = output.match(/https:\/\/[^\s]+/);
                if (urlMatch && !this.tunnelUrl) {
                    this.tunnelUrl = urlMatch[0];
                    log.info(`Tailscale funnel active: ${this.tunnelUrl}`);
                    resolve(this.tunnelUrl);
                }
            });

            this.process.on('error', (error) => {
                reject(new Error(`Failed to start tailscale: ${error.message}`));
            });

            setTimeout(() => {
                if (!this.tunnelUrl) {
                    reject(new Error('Tailscale funnel timed out after 30s'));
                }
            }, 30000);
        });
    }

    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
            this.tunnelUrl = null;
            log.info('Tailscale funnel stopped');
        }
    }

    status(): TunnelStatus {
        return {
            running: !!this.process,
            provider: 'tailscale',
            url: this.tunnelUrl || undefined,
            pid: this.process?.pid,
        };
    }
}

// ── Custom Tunnel (validated command) ──

// CVE-2026-25253: Only allow known tunnel binaries to prevent arbitrary command execution
const ALLOWED_TUNNEL_BINARIES = new Set([
    'bore', 'localtunnel', 'lt', 'frp', 'frpc', 'serveo', 'rathole',
    'chisel', 'pgrok', 'zrok', 'localhost.run',
]);

const TUNNEL_SHELL_METACHARACTERS = /[;|&$`"'\\<>(){}!#~\n\r]/;

class CustomTunnel implements TunnelProvider {
    private process: ChildProcess | null = null;
    private customCommand: string;

    constructor(command: string) {
        // Security: Validate the custom command before accepting
        this.validateCommand(command);
        this.customCommand = command;
    }

    private validateCommand(command: string): void {
        if (!command || typeof command !== 'string') {
            throw new Error('Custom tunnel command must be a non-empty string');
        }

        // Block shell metacharacters
        if (TUNNEL_SHELL_METACHARACTERS.test(command)) {
            throw new Error(
                'Custom tunnel command contains shell metacharacters. ' +
                'Only simple commands with arguments are allowed.'
            );
        }

        // Extract binary name
        const parts = command.trim().split(/\s+/);
        const binary = parts[0].split('/').pop()?.split('\\').pop() || '';

        // Validate against allowlist
        if (!ALLOWED_TUNNEL_BINARIES.has(binary.toLowerCase())) {
            throw new Error(
                `Custom tunnel binary "${binary}" is not in the allowlist. ` +
                `Allowed: ${[...ALLOWED_TUNNEL_BINARIES].join(', ')}. ` +
                `Use cloudflare, ngrok, or tailscale provider for those tools.`
            );
        }

        log.info(`Custom tunnel command validated: ${binary}`);
    }

    async start(port: number): Promise<string> {
        const cmd = this.customCommand.replace('{{PORT}}', String(port));
        const [bin, ...args] = cmd.split(/\s+/);

        return new Promise((resolve, reject) => {
            this.process = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

            this.process.on('error', (error) => {
                reject(new Error(`Custom tunnel failed: ${error.message}`));
            });

            // Give it a few seconds, assume it's running
            setTimeout(() => {
                if (this.process) {
                    resolve(`custom tunnel running (pid ${this.process.pid})`);
                } else {
                    reject(new Error('Custom tunnel exited immediately'));
                }
            }, 3000);
        });
    }

    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
            log.info('Custom tunnel stopped');
        }
    }

    status(): TunnelStatus {
        return {
            running: !!this.process,
            provider: 'custom',
            pid: this.process?.pid,
        };
    }
}

// ── Tunnel Manager ──

export class TunnelManager {
    private provider: TunnelProvider | null = null;
    private config: TunnelConfig;

    constructor(config: TunnelConfig) {
        this.config = config;
    }

    async start(port?: number): Promise<string> {
        const tunnelPort = port || this.config.port || 3000;

        switch (this.config.provider) {
            case 'cloudflare':
                this.provider = new CloudflareTunnel();
                break;
            case 'ngrok':
                this.provider = new NgrokTunnel(this.config.auth_token);
                break;
            case 'tailscale':
                this.provider = new TailscaleTunnel();
                break;
            case 'custom':
                if (!this.config.custom_command) {
                    throw new Error('custom_command required for custom tunnel provider');
                }
                this.provider = new CustomTunnel(this.config.custom_command);
                break;
            case 'none':
            default:
                throw new Error('No tunnel provider configured. Set tunnel.provider in config.');
        }

        return this.provider.start(tunnelPort);
    }

    async stop(): Promise<void> {
        if (this.provider) {
            await this.provider.stop();
            this.provider = null;
        }
    }

    status(): TunnelStatus {
        if (this.provider) {
            return this.provider.status();
        }
        return { running: false, provider: this.config.provider };
    }
}

// Singleton
let tunnelManager: TunnelManager | null = null;

export function getTunnelManager(): TunnelManager {
    if (!tunnelManager) {
        tunnelManager = new TunnelManager({ provider: 'none' });
    }
    return tunnelManager;
}

export function createTunnelManager(config: TunnelConfig): TunnelManager {
    tunnelManager = new TunnelManager(config);
    return tunnelManager;
}

export default TunnelManager;
