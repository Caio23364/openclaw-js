/**
 * OpenClaw - Security Sandbox
 * Picoclaw-inspired security sandbox for filesystem and command isolation.
 * Restricts agent file operations to the workspace directory and blocks
 * dangerous shell commands.
 *
 * Security hardening:
 * - CVE-2026-24763: Docker escape / PATH manipulation defense
 * - CVE-2026-25157: SSH hostname injection defense
 * - CVE-2026-25256: Path traversal defense
 */

import { resolve, normalize } from 'path';
import { log } from '../utils/logger.js';

// Dangerous commands that should be blocked
const DANGEROUS_COMMANDS: string[] = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'format',
    'mkfs',
    'dd if=',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'init 0',
    'init 6',
    ':(){:|:&};:',           // Fork bomb
    'chmod -R 777 /',
    'chown -R',
    'del /f /s /q',          // Windows
    'rd /s /q',              // Windows
    'deltree',               // Windows
    'curl | sh',
    'curl | bash',
    'wget | sh',
    'wget | bash',
    'eval(',                 // JS eval injection
    '> /dev/sda',
    '> /dev/null',
    'mv / ',
    'cp /dev/random',
    // Docker escape vectors (CVE-2026-24763)
    'docker run',
    'docker exec',
    'docker cp',
    'nsenter',
    'chroot',
    'mount -o bind',
    'unshare',
    // Privilege escalation
    'sudo ',
    'su -',
    'pkexec',
    'doas ',
    // Network exfiltration
    'nc -l',
    'netcat',
    'ncat',
    'socat',
];

// Dangerous path patterns (never allow access)
const DANGEROUS_PATHS: string[] = [
    '/etc/shadow',
    '/etc/passwd',
    '/etc/sudoers',
    '/root/.ssh',
    '/.ssh/id_rsa',
    '/.ssh/id_ed25519',
    '/proc/kcore',
    '/dev/sda',
    '/dev/mem',
    '\\windows\\system32',
    '\\system32',
];

/**
 * Check if a file path is within the allowed workspace directory.
 */
export function isPathAllowed(filePath: string, workspace: string): boolean {
    try {
        const resolvedPath = resolve(normalize(filePath));
        const resolvedWorkspace = resolve(normalize(workspace));

        // Must be within workspace
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
            log.warn(`Sandbox: blocked path outside workspace: ${filePath}`);
            return false;
        }

        // Check against dangerous paths
        const lowerPath = resolvedPath.toLowerCase();
        for (const dangerousPath of DANGEROUS_PATHS) {
            if (lowerPath.includes(dangerousPath.toLowerCase())) {
                log.warn(`Sandbox: blocked dangerous path: ${filePath}`);
                return false;
            }
        }

        // Block path traversal attempts
        if (filePath.includes('..')) {
            const finalResolved = resolve(workspace, filePath);
            if (!finalResolved.startsWith(resolvedWorkspace)) {
                log.warn(`Sandbox: blocked path traversal: ${filePath}`);
                return false;
            }
        }

        return true;
    } catch (error) {
        log.error(`Sandbox: path validation error for ${filePath}:`, error);
        return false;
    }
}

/**
 * Check if a shell command is safe to execute.
 * Returns false if the command matches a known dangerous pattern.
 */
export function isCommandSafe(command: string): boolean {
    const lowerCmd = command.toLowerCase().trim();

    for (const dangerous of DANGEROUS_COMMANDS) {
        if (lowerCmd.includes(dangerous.toLowerCase())) {
            log.warn(`Sandbox: blocked dangerous command: ${command}`);
            return false;
        }
    }

    // Block piped curl/wget execution
    if (/curl\s+.*\|\s*(sh|bash|zsh|python)/.test(lowerCmd)) {
        log.warn(`Sandbox: blocked piped download: ${command}`);
        return false;
    }

    // Block base64 decode into execution
    if (/base64\s+(-d|--decode).*\|\s*(sh|bash)/.test(lowerCmd)) {
        log.warn(`Sandbox: blocked encoded execution: ${command}`);
        return false;
    }

    // CVE-2026-24763: Block PATH manipulation for Docker escape
    if (/\bPATH\s*=/.test(command)) {
        log.warn(`Sandbox: blocked PATH manipulation: ${command}`);
        return false;
    }

    // CVE-2026-25157: Block SSH with hostname starting with "--"
    if (/\bssh\s+--/.test(lowerCmd)) {
        log.warn(`Sandbox: blocked SSH flag injection: ${command}`);
        return false;
    }

    // Block environment variable injection into commands
    if (/\benv\s+.*=.*\s+/.test(lowerCmd) && /\b(sh|bash|node|python|ruby)\b/.test(lowerCmd)) {
        log.warn(`Sandbox: blocked env injection into shell: ${command}`);
        return false;
    }

    // Block reverse shells
    if (/\/dev\/(tcp|udp)/.test(lowerCmd)) {
        log.warn(`Sandbox: blocked reverse shell attempt: ${command}`);
        return false;
    }

    return true;
}

/**
 * Sanitize and resolve a path relative to the workspace.
 * Returns null if the path is not allowed.
 */
export function sanitizePath(filePath: string, workspace: string): string | null {
    try {
        // Resolve relative to workspace
        const resolved = resolve(workspace, filePath);

        if (!isPathAllowed(resolved, workspace)) {
            return null;
        }

        return resolved;
    } catch {
        return null;
    }
}

/**
 * Redact sensitive information from strings (picoclaw-inspired privacy protection).
 * Masks API keys, tokens, passwords and PII from logs and outputs.
 */
export function redactSensitive(text: string): string {
    let result = text;

    // API keys (common formats)
    result = result.replace(/(?:sk-|api[_-]?key[=:]\s*)[a-zA-Z0-9_-]{20,}/gi, '[REDACTED_API_KEY]');

    // Bearer tokens
    result = result.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');

    // Passwords in URLs
    result = result.replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED]@');

    // Environment variable patterns with sensitive names
    result = result.replace(/(password|secret|token|api_key|apikey|auth)\s*[=:]\s*\S+/gi,
        (match) => match.split(/[=:]/)[0] + '=[REDACTED]');

    return result;
}

export interface SandboxConfig {
    /** Whether the sandbox is enabled */
    enabled: boolean;
    /** Workspace directory for the sandbox */
    workspace: string;
    /** Additional allowed paths outside workspace */
    allowedPaths?: string[];
    /** Whether to redact sensitive data in logs */
    redactLogs?: boolean;
}

/**
 * Create a sandbox verifier for a specific workspace.
 */
export function createSandbox(config: SandboxConfig) {
    return {
        isPathAllowed: (path: string) => {
            if (!config.enabled) return true;

            // Check workspace
            if (isPathAllowed(path, config.workspace)) return true;

            // Check additional allowed paths
            if (config.allowedPaths) {
                for (const allowed of config.allowedPaths) {
                    if (isPathAllowed(path, allowed)) return true;
                }
            }

            return false;
        },

        isCommandSafe: (command: string) => {
            if (!config.enabled) return true;
            return isCommandSafe(command);
        },

        sanitizePath: (path: string) => {
            if (!config.enabled) return resolve(path);
            return sanitizePath(path, config.workspace);
        },

        redact: (text: string) => {
            if (!config.redactLogs) return text;
            return redactSensitive(text);
        },
    };
}
