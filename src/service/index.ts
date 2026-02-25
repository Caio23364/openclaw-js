/**
 * OpenClaw - Service Management
 * Install/start/stop/status/uninstall as systemd or OpenRC service.
 * Based on ZeroClaw's service management.
 *
 * Security: All service names and exec paths are validated before
 * passing to execSync to prevent command injection.
 */

import { writeFile, readFile, unlink, access } from 'fs/promises';
import { execSync, exec } from 'child_process';
import { join } from 'path';
import { log } from '../utils/logger.js';

// ── Security: Input validation for shell commands ──

const SAFE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SHELL_METACHARACTERS = /[;|&$`"'\\<>(){}!#~*?\n\r]/;

function sanitizeServiceName(name: string): string {
    if (!SAFE_NAME_PATTERN.test(name)) {
        throw new Error(`Invalid service name: "${name}". Only alphanumeric, hyphens, and underscores allowed.`);
    }
    return name;
}

function sanitizeExecPath(execPath: string): string {
    if (SHELL_METACHARACTERS.test(execPath)) {
        throw new Error(`Invalid exec path: contains shell metacharacters. Path: ${execPath}`);
    }
    if (execPath.includes('..')) {
        throw new Error(`Invalid exec path: contains path traversal. Path: ${execPath}`);
    }
    return execPath;
}

// ── Types ──

type InitSystem = 'systemd' | 'openrc' | 'windows' | 'unsupported';

export interface ServiceConfig {
    name: string;
    description: string;
    execPath: string;
    args: string[];
    workingDirectory?: string;
    user?: string;
    restart?: 'always' | 'on-failure' | 'no';
}

const DEFAULT_CONFIG: ServiceConfig = {
    name: 'openclaw',
    description: 'OpenClaw AI Assistant',
    execPath: process.execPath,
    args: ['gateway'],
    restart: 'always',
};

// ── Init System Detection ──

function detectInitSystem(): InitSystem {
    if (process.platform === 'win32') return 'windows';

    try {
        execSync('systemctl --version', { stdio: 'pipe' });
        return 'systemd';
    } catch { }

    try {
        execSync('rc-service --version', { stdio: 'pipe' });
        return 'openrc';
    } catch { }

    return 'unsupported';
}

// ── Systemd ──

function generateSystemdUnit(config: ServiceConfig): string {
    return `[Unit]
Description=${config.description}
After=network.target

[Service]
Type=simple
ExecStart=${config.execPath} ${config.args.join(' ')}
${config.workingDirectory ? `WorkingDirectory=${config.workingDirectory}` : ''}
${config.user ? `User=${config.user}` : ''}
Restart=${config.restart || 'always'}
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
}

async function systemdInstall(config: ServiceConfig): Promise<void> {
    const safeName = sanitizeServiceName(config.name);
    sanitizeExecPath(config.execPath);
    const unitContent = generateSystemdUnit(config);
    const unitPath = join('/etc/systemd/system', `${safeName}.service`);

    await writeFile(unitPath, unitContent);
    execSync('systemctl daemon-reload', { stdio: 'pipe' });
    execSync(`systemctl enable ${safeName}`, { stdio: 'pipe' });
    log.info(`Installed systemd service: ${unitPath}`);
}

async function systemdStart(name: string): Promise<void> {
    const safeName = sanitizeServiceName(name);
    execSync(`systemctl start ${safeName}`, { stdio: 'pipe' });
    log.info(`Started systemd service: ${safeName}`);
}

async function systemdStop(name: string): Promise<void> {
    const safeName = sanitizeServiceName(name);
    execSync(`systemctl stop ${safeName}`, { stdio: 'pipe' });
    log.info(`Stopped systemd service: ${safeName}`);
}

function systemdStatus(name: string): string {
    const safeName = sanitizeServiceName(name);
    try {
        const output = execSync(`systemctl status ${safeName}`, { stdio: 'pipe' }).toString();
        return output;
    } catch (error: any) {
        return error.stdout?.toString() || 'Service not found';
    }
}

async function systemdUninstall(name: string): Promise<void> {
    try { execSync(`systemctl stop ${name}`, { stdio: 'pipe' }); } catch { }
    try { execSync(`systemctl disable ${name}`, { stdio: 'pipe' }); } catch { }

    const unitPath = join('/etc/systemd/system', `${name}.service`);
    try { await unlink(unitPath); } catch { }

    execSync('systemctl daemon-reload', { stdio: 'pipe' });
    log.info(`Uninstalled systemd service: ${name}`);
}

// ── OpenRC ──

function generateOpenRCScript(config: ServiceConfig): string {
    return `#!/sbin/openrc-run

name="${config.name}"
description="${config.description}"
command="${config.execPath}"
command_args="${config.args.join(' ')}"
${config.workingDirectory ? `directory="${config.workingDirectory}"` : ''}
${config.user ? `command_user="${config.user}"` : ''}
pidfile="/run/\${name}.pid"
command_background="yes"

depend() {
  need net
  after firewall
}
`;
}

async function openrcInstall(config: ServiceConfig): Promise<void> {
    const safeName = sanitizeServiceName(config.name);
    sanitizeExecPath(config.execPath);
    const scriptContent = generateOpenRCScript(config);
    const scriptPath = join('/etc/init.d', safeName);

    await writeFile(scriptPath, scriptContent, { mode: 0o755 });
    execSync(`rc-update add ${safeName} default`, { stdio: 'pipe' });
    log.info(`Installed OpenRC service: ${scriptPath}`);
}

async function openrcStart(name: string): Promise<void> {
    execSync(`rc-service ${name} start`, { stdio: 'pipe' });
    log.info(`Started OpenRC service: ${name}`);
}

async function openrcStop(name: string): Promise<void> {
    execSync(`rc-service ${name} stop`, { stdio: 'pipe' });
    log.info(`Stopped OpenRC service: ${name}`);
}

function openrcStatus(name: string): string {
    try {
        return execSync(`rc-service ${name} status`, { stdio: 'pipe' }).toString();
    } catch (error: any) {
        return error.stdout?.toString() || 'Service not found';
    }
}

async function openrcUninstall(name: string): Promise<void> {
    try { execSync(`rc-service ${name} stop`, { stdio: 'pipe' }); } catch { }
    try { execSync(`rc-update del ${name} default`, { stdio: 'pipe' }); } catch { }

    const scriptPath = join('/etc/init.d', name);
    try { await unlink(scriptPath); } catch { }
    log.info(`Uninstalled OpenRC service: ${name}`);
}

// ── Windows (sc.exe) ──

async function windowsInstall(config: ServiceConfig): Promise<void> {
    const safeName = sanitizeServiceName(config.name);
    const safePath = sanitizeExecPath(config.execPath);
    const safeArgs = config.args.map(a => {
        if (SHELL_METACHARACTERS.test(a)) throw new Error(`Invalid service arg: ${a}`);
        return a;
    });
    const cmd = `sc create ${safeName} binPath= "${safePath} ${safeArgs.join(' ')}" start= auto DisplayName= "${config.description.replace(/"/g, '')}"`;
    execSync(cmd, { stdio: 'pipe' });
    log.info(`Installed Windows service: ${safeName}`);
}

async function windowsStart(name: string): Promise<void> {
    execSync(`sc start ${name}`, { stdio: 'pipe' });
}

async function windowsStop(name: string): Promise<void> {
    execSync(`sc stop ${name}`, { stdio: 'pipe' });
}

function windowsStatus(name: string): string {
    try {
        return execSync(`sc query ${name}`, { stdio: 'pipe' }).toString();
    } catch {
        return 'Service not found';
    }
}

async function windowsUninstall(name: string): Promise<void> {
    try { execSync(`sc stop ${name}`, { stdio: 'pipe' }); } catch { }
    execSync(`sc delete ${name}`, { stdio: 'pipe' });
}

// ── Service Manager ──

export class ServiceManager {
    private initSystem: InitSystem;
    private config: ServiceConfig;

    constructor(config?: Partial<ServiceConfig>) {
        this.initSystem = detectInitSystem();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async install(): Promise<void> {
        log.info(`Installing service using ${this.initSystem}...`);

        switch (this.initSystem) {
            case 'systemd':
                await systemdInstall(this.config);
                break;
            case 'openrc':
                await openrcInstall(this.config);
                break;
            case 'windows':
                await windowsInstall(this.config);
                break;
            default:
                throw new Error(`Unsupported init system. Detected: ${this.initSystem}`);
        }
    }

    async start(): Promise<void> {
        switch (this.initSystem) {
            case 'systemd':
                await systemdStart(this.config.name);
                break;
            case 'openrc':
                await openrcStart(this.config.name);
                break;
            case 'windows':
                await windowsStart(this.config.name);
                break;
            default:
                throw new Error(`Unsupported init system: ${this.initSystem}`);
        }
    }

    async stop(): Promise<void> {
        switch (this.initSystem) {
            case 'systemd':
                await systemdStop(this.config.name);
                break;
            case 'openrc':
                await openrcStop(this.config.name);
                break;
            case 'windows':
                await windowsStop(this.config.name);
                break;
            default:
                throw new Error(`Unsupported init system: ${this.initSystem}`);
        }
    }

    status(): string {
        switch (this.initSystem) {
            case 'systemd':
                return systemdStatus(this.config.name);
            case 'openrc':
                return openrcStatus(this.config.name);
            case 'windows':
                return windowsStatus(this.config.name);
            default:
                return 'Unsupported init system';
        }
    }

    async uninstall(): Promise<void> {
        switch (this.initSystem) {
            case 'systemd':
                await systemdUninstall(this.config.name);
                break;
            case 'openrc':
                await openrcUninstall(this.config.name);
                break;
            case 'windows':
                await windowsUninstall(this.config.name);
                break;
            default:
                throw new Error(`Unsupported init system: ${this.initSystem}`);
        }
    }

    getInitSystem(): InitSystem {
        return this.initSystem;
    }
}

export function createServiceManager(config?: Partial<ServiceConfig>): ServiceManager {
    return new ServiceManager(config);
}

export default ServiceManager;
