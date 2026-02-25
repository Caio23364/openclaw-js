/**
 * OpenClaw - Docker Runtime
 * Execute agent shell commands inside Docker containers.
 * Supports memory limits, CPU limits, network isolation, and workspace mounting.
 * Based on ZeroClaw's Docker runtime.
 */

import { spawn } from 'child_process';
import { log } from '../utils/logger.js';
import { WORKSPACE_DIR } from '../utils/config.js';

// ── Types ──

export interface DockerConfig {
    /** Container image (default: "node:20-alpine") */
    image: string;
    /** Docker network mode: "none", "bridge", "host" */
    network: string;
    /** Memory limit in MB */
    memory_limit_mb: number;
    /** CPU limit (e.g. 1.0 = one core) */
    cpu_limit: number;
    /** Mount root filesystem as read-only */
    read_only_rootfs: boolean;
    /** Mount workspace into /workspace */
    mount_workspace: boolean;
    /** Allowed workspace roots for mount validation */
    allowed_workspace_roots: string[];
    /** Container timeout in seconds (default: 300) */
    timeout_secs: number;
}

export interface DockerExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
}

const DEFAULT_DOCKER_CONFIG: DockerConfig = {
    image: 'node:20-alpine',
    network: 'none',
    memory_limit_mb: 512,
    cpu_limit: 1.0,
    read_only_rootfs: true,
    mount_workspace: true,
    allowed_workspace_roots: [],
    timeout_secs: 300,
};

// ── Docker Runtime ──

export class DockerRuntime {
    private config: DockerConfig;
    private workspace: string;
    private available: boolean | null = null;

    constructor(config?: Partial<DockerConfig>, workspace?: string) {
        this.config = { ...DEFAULT_DOCKER_CONFIG, ...config };
        this.workspace = workspace || WORKSPACE_DIR;
    }

    /**
     * Check if Docker daemon is available.
     */
    async isAvailable(): Promise<boolean> {
        if (this.available !== null) return this.available;

        try {
            const result = await this.runDockerCommand(['version', '--format', '{{.Server.Version}}']);
            this.available = result.exitCode === 0;
            if (this.available) {
                log.info(`Docker available: v${result.stdout.trim()}`);
            }
        } catch {
            this.available = false;
            log.warn('Docker is not available');
        }

        return this.available;
    }

    /**
     * Execute a command inside a Docker container.
     */
    async execute(command: string, options: {
        image?: string;
        env?: Record<string, string>;
        workdir?: string;
        timeout?: number;
    } = {}): Promise<DockerExecResult> {
        if (!(await this.isAvailable())) {
            throw new Error('Docker is not available. Install Docker or switch to runtime.kind = "native"');
        }

        const image = options.image || this.config.image;
        const args = this.buildDockerArgs(image, command, options);

        log.info(`Docker exec: ${command} (image: ${image})`);
        return this.runDockerCommand(args, options.timeout || this.config.timeout_secs);
    }

    /**
     * Execute a command with streaming output.
     */
    async executeStream(
        command: string,
        onOutput: (data: string, stream: 'stdout' | 'stderr') => void,
        options: { image?: string; env?: Record<string, string> } = {}
    ): Promise<DockerExecResult> {
        if (!(await this.isAvailable())) {
            throw new Error('Docker is not available');
        }

        const image = options.image || this.config.image;
        const args = this.buildDockerArgs(image, command, options);

        return new Promise((resolve) => {
            const start = Date.now();
            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGKILL');
            }, this.config.timeout_secs * 1000);

            proc.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                onOutput(text, 'stdout');
            });

            proc.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                onOutput(text, 'stderr');
            });

            proc.on('exit', (code) => {
                clearTimeout(timer);
                resolve({
                    exitCode: code ?? 1,
                    stdout,
                    stderr,
                    timedOut,
                    durationMs: Date.now() - start,
                });
            });

            proc.on('error', (error) => {
                clearTimeout(timer);
                resolve({
                    exitCode: 1,
                    stdout,
                    stderr: `${stderr}\n${error.message}`,
                    timedOut: false,
                    durationMs: Date.now() - start,
                });
            });
        });
    }

    /**
     * Pull a Docker image.
     */
    async pullImage(image?: string): Promise<void> {
        const img = image || this.config.image;
        log.info(`Pulling Docker image: ${img}`);
        const result = await this.runDockerCommand(['pull', img]);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to pull image ${img}: ${result.stderr}`);
        }
    }

    /**
     * List running OpenClaw containers.
     */
    async listContainers(): Promise<string[]> {
        const result = await this.runDockerCommand([
            'ps', '--filter', 'label=openclaw', '--format', '{{.ID}} {{.Image}} {{.Status}}',
        ]);
        return result.stdout.trim().split('\n').filter(Boolean);
    }

    /**
     * Clean up stopped OpenClaw containers.
     */
    async cleanup(): Promise<number> {
        const result = await this.runDockerCommand([
            'container', 'prune', '--filter', 'label=openclaw', '-f',
        ]);
        const match = result.stdout.match(/Deleted (\d+)/);
        const count = match ? parseInt(match[1]) : 0;
        if (count > 0) log.info(`Cleaned up ${count} Docker containers`);
        return count;
    }

    // ── Internal ──

    private buildDockerArgs(image: string, command: string, options: {
        env?: Record<string, string>;
        workdir?: string;
    } = {}): string[] {
        const args = ['run', '--rm', '--label', 'openclaw'];

        // Memory limit
        if (this.config.memory_limit_mb > 0) {
            args.push('--memory', `${this.config.memory_limit_mb}m`);
        }

        // CPU limit
        if (this.config.cpu_limit > 0) {
            args.push('--cpus', String(this.config.cpu_limit));
        }

        // Network
        args.push('--network', this.config.network);

        // Read-only rootfs
        if (this.config.read_only_rootfs) {
            args.push('--read-only');
            // Need a writable /tmp for most commands
            args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');
        }

        // Mount workspace
        if (this.config.mount_workspace) {
            args.push('-v', `${this.workspace}:/workspace:rw`);
            args.push('-w', '/workspace');
        }

        // Working directory override
        if (options.workdir) {
            args.push('-w', options.workdir);
        }

        // Environment variables
        if (options.env) {
            for (const [key, val] of Object.entries(options.env)) {
                args.push('-e', `${key}=${val}`);
            }
        }

        // Security: no new privileges
        args.push('--security-opt', 'no-new-privileges');

        // Image
        args.push(image);

        // Command — run through shell
        args.push('sh', '-c', command);

        return args;
    }

    private runDockerCommand(args: string[], timeoutSecs?: number): Promise<DockerExecResult> {
        return new Promise((resolve) => {
            const start = Date.now();
            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

            const timer = timeoutSecs
                ? setTimeout(() => {
                    timedOut = true;
                    proc.kill('SIGKILL');
                }, timeoutSecs * 1000)
                : null;

            proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('exit', (code) => {
                if (timer) clearTimeout(timer);
                resolve({
                    exitCode: code ?? 1,
                    stdout,
                    stderr,
                    timedOut,
                    durationMs: Date.now() - start,
                });
            });

            proc.on('error', (error) => {
                if (timer) clearTimeout(timer);
                resolve({
                    exitCode: 1,
                    stdout,
                    stderr: error.message,
                    timedOut: false,
                    durationMs: Date.now() - start,
                });
            });
        });
    }

    getConfig(): DockerConfig {
        return { ...this.config };
    }
}

// Singleton
let dockerRuntime: DockerRuntime | null = null;

export function getDockerRuntime(): DockerRuntime {
    if (!dockerRuntime) {
        dockerRuntime = new DockerRuntime();
    }
    return dockerRuntime;
}

export function createDockerRuntime(config?: Partial<DockerConfig>, workspace?: string): DockerRuntime {
    dockerRuntime = new DockerRuntime(config, workspace);
    return dockerRuntime;
}

export default DockerRuntime;
