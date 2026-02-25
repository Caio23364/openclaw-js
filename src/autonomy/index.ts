/**
 * OpenClaw - Autonomy System
 * Controls what agents can do: readonly, supervised, or full autonomy.
 * Based on ZeroClaw's autonomy levels.
 */

import { log } from '../utils/logger.js';
import { join, resolve, isAbsolute } from 'path';
import { WORKSPACE_DIR } from '../utils/config.js';

// ── Types ──

export type AutonomyLevel = 'readonly' | 'supervised' | 'full';

export interface AutonomyConfig {
    /** Autonomy level: how much the agent can do */
    level: AutonomyLevel;
    /** Restrict all file operations to workspace only */
    workspace_only: boolean;
    /** Commands the agent is allowed to run */
    allowed_commands: string[];
    /** Paths the agent is never allowed to access */
    forbidden_paths: string[];
    /** Additional root paths allowed outside workspace */
    allowed_roots: string[];
}

const DEFAULT_FORBIDDEN_PATHS = [
    '/etc',
    '/root',
    '/proc',
    '/sys',
    '~/.ssh',
    '~/.gnupg',
    '~/.aws',
    '~/.config/gcloud',
    'C:\\Windows\\System32',
];

const DEFAULT_ALLOWED_COMMANDS = [
    'git', 'npm', 'npx', 'node', 'cargo', 'ls', 'dir', 'cat', 'type',
    'grep', 'find', 'echo', 'pwd', 'cd', 'mkdir', 'touch', 'head',
    'tail', 'wc', 'sort', 'diff', 'tree', 'which', 'where',
];

const DANGEROUS_COMMANDS = [
    'rm -rf /',
    'rm -rf /*',
    'format',
    'mkfs',
    'dd if=',
    'shutdown',
    'reboot',
    'halt',
    ':(){:|:&};:',
    'wget -O - | sh',
    'curl | sh',
    'chmod 777',
    'chown root',
];

// ── Autonomy Manager ──

export class AutonomyManager {
    private config: AutonomyConfig;
    private workspace: string;

    constructor(config?: Partial<AutonomyConfig>, workspace?: string) {
        this.workspace = workspace || WORKSPACE_DIR;
        this.config = {
            level: config?.level || 'supervised',
            workspace_only: config?.workspace_only ?? true,
            allowed_commands: config?.allowed_commands || DEFAULT_ALLOWED_COMMANDS,
            forbidden_paths: config?.forbidden_paths || DEFAULT_FORBIDDEN_PATHS,
            allowed_roots: config?.allowed_roots || [],
        };
    }

    /**
     * Check if the agent is allowed to execute a shell command.
     */
    public canExecuteCommand(command: string): { allowed: boolean; reason?: string } {
        // Readonly mode — no commands at all
        if (this.config.level === 'readonly') {
            return { allowed: false, reason: 'Autonomy level is readonly — no command execution allowed' };
        }

        // Check for dangerous patterns
        const lowered = command.toLowerCase().trim();
        for (const dangerous of DANGEROUS_COMMANDS) {
            if (lowered.includes(dangerous)) {
                return { allowed: false, reason: `Blocked dangerous command pattern: ${dangerous}` };
            }
        }

        // Extract base command
        const baseCommand = command.split(/\s+/)[0].replace(/^(sudo\s+)?/, '').split('/').pop() || '';

        // Check allowlist
        if (this.config.allowed_commands.length > 0) {
            const isAllowed = this.config.allowed_commands.some((cmd) =>
                baseCommand === cmd || baseCommand.endsWith(`/${cmd}`)
            );

            if (!isAllowed) {
                if (this.config.level === 'supervised') {
                    return { allowed: false, reason: `Command "${baseCommand}" not in allowlist. Requires approval.` };
                }
                // Full autonomy — allow but log
                log.warn(`Autonomy: allowing unlisted command "${baseCommand}" in full mode`);
            }
        }

        return { allowed: true };
    }

    /**
     * Check if the agent is allowed to access a file path.
     */
    public canAccessPath(filePath: string): { allowed: boolean; reason?: string } {
        const resolved = this.resolvePath(filePath);

        // Check forbidden paths
        for (const forbidden of this.config.forbidden_paths) {
            const resolvedForbidden = this.resolvePath(forbidden);
            if (resolved.startsWith(resolvedForbidden)) {
                return { allowed: false, reason: `Path is forbidden: ${forbidden}` };
            }
        }

        // Check workspace restriction
        if (this.config.workspace_only) {
            const isInWorkspace = resolved.startsWith(resolve(this.workspace));
            const isInAllowedRoot = this.config.allowed_roots.some((root) => {
                const resolvedRoot = this.resolvePath(root);
                return resolved.startsWith(resolvedRoot);
            });

            if (!isInWorkspace && !isInAllowedRoot) {
                return {
                    allowed: false,
                    reason: `Path "${filePath}" is outside workspace. Set workspace_only=false or add to allowed_roots.`,
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Check if the agent is allowed to write to a file path.
     */
    public canWriteFile(filePath: string): { allowed: boolean; reason?: string } {
        if (this.config.level === 'readonly') {
            return { allowed: false, reason: 'Autonomy level is readonly — no write operations allowed' };
        }

        return this.canAccessPath(filePath);
    }

    /**
     * Check if the agent is allowed to delete a file.
     */
    public canDeleteFile(filePath: string): { allowed: boolean; reason?: string } {
        if (this.config.level === 'readonly') {
            return { allowed: false, reason: 'Autonomy level is readonly — no delete operations allowed' };
        }

        if (this.config.level === 'supervised') {
            return { allowed: false, reason: 'Autonomy level is supervised — file deletion requires approval' };
        }

        return this.canAccessPath(filePath);
    }

    /**
     * Check if an operation requires user approval.
     */
    public requiresApproval(operation: string): boolean {
        if (this.config.level === 'full') return false;
        if (this.config.level === 'readonly') return true;

        // Supervised — approve destructive operations
        const destructive = ['delete', 'remove', 'drop', 'truncate', 'format', 'overwrite'];
        return destructive.some((d) => operation.toLowerCase().includes(d));
    }

    public getLevel(): AutonomyLevel {
        return this.config.level;
    }

    public getConfig(): AutonomyConfig {
        return { ...this.config };
    }

    private resolvePath(p: string): string {
        const expanded = p.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '');
        return isAbsolute(expanded) ? resolve(expanded) : resolve(this.workspace, expanded);
    }
}

// Singleton
let autonomyManager: AutonomyManager | null = null;

export function getAutonomyManager(): AutonomyManager {
    if (!autonomyManager) {
        autonomyManager = new AutonomyManager();
    }
    return autonomyManager;
}

export function createAutonomyManager(config?: Partial<AutonomyConfig>, workspace?: string): AutonomyManager {
    autonomyManager = new AutonomyManager(config, workspace);
    return autonomyManager;
}

export default AutonomyManager;
