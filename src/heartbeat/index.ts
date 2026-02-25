/**
 * OpenClaw - Heartbeat System
 * Picoclaw-inspired periodic task execution.
 * Reads HEARTBEAT.md from the workspace and executes listed tasks
 * at a configurable interval.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';

export interface HeartbeatTask {
    description: string;
    type: 'quick' | 'long';
}

export class HeartbeatManager {
    private timer?: ReturnType<typeof setInterval>;
    private running = false;
    private workspace: string = '';
    private intervalMs: number = 30 * 60 * 1000;
    private lastRun?: Date;
    private tasksExecuted = 0;

    public async initialize(): Promise<void> {
        const config = await getConfig();

        if (!config.heartbeat?.enabled) {
            log.info('Heartbeat system disabled');
            return;
        }

        this.workspace = config.sandbox?.workspace || join(process.cwd(), 'workspace');
        this.intervalMs = (config.heartbeat.interval || 30) * 60 * 1000;

        log.info(`Heartbeat system initialized (interval: ${config.heartbeat.interval}min)`);
        this.start();
    }

    public start(): void {
        if (this.running) return;

        this.running = true;
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        log.info('Heartbeat started');

        // Run first tick after a short delay
        setTimeout(() => this.tick(), 5000);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.running = false;
        log.info('Heartbeat stopped');
    }

    private async tick(): Promise<void> {
        try {
            const tasks = await this.loadTasks();
            if (tasks.length === 0) return;

            log.info(`Heartbeat: executing ${tasks.length} tasks`);

            for (const task of tasks) {
                try {
                    await this.executeTask(task);
                    this.tasksExecuted++;
                } catch (error) {
                    log.error(`Heartbeat: task failed: ${task.description}`, error);
                }
            }

            this.lastRun = new Date();
            log.info(`Heartbeat: completed ${tasks.length} tasks`);
        } catch (error) {
            log.error('Heartbeat tick failed:', error);
        }
    }

    /**
     * Reads and parses HEARTBEAT.md from the workspace.
     * Format:
     * ```markdown
     * # Periodic Tasks
     * ## Quick Tasks
     * - Check system status
     * - Report current time
     * ## Long Tasks
     * - Search the web for AI news
     * - Check email
     * ```
     */
    private async loadTasks(): Promise<HeartbeatTask[]> {
        const heartbeatFile = join(this.workspace, 'HEARTBEAT.md');

        try {
            const content = await readFile(heartbeatFile, 'utf-8');
            return this.parseTasks(content);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // No HEARTBEAT.md — this is normal, just skip
                return [];
            }
            log.error('Failed to read HEARTBEAT.md:', error);
            return [];
        }
    }

    private parseTasks(content: string): HeartbeatTask[] {
        const tasks: HeartbeatTask[] = [];
        let currentType: 'quick' | 'long' = 'quick';

        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Detect section headers
            if (/^##?\s+.*long/i.test(trimmed)) {
                currentType = 'long';
                continue;
            }
            if (/^##?\s+.*quick/i.test(trimmed)) {
                currentType = 'quick';
                continue;
            }

            // Parse list items as tasks
            const match = trimmed.match(/^[-*]\s+(.+)$/);
            if (match) {
                tasks.push({
                    description: match[1].trim(),
                    type: currentType,
                });
            }
        }

        return tasks;
    }

    /**
     * Execute a heartbeat task.
     * For now, this logs the task — when the agent runtime supports
     * autonomous execution, this will dispatch to the agent.
     */
    private async executeTask(task: HeartbeatTask): Promise<void> {
        log.info(`Heartbeat [${task.type}]: ${task.description}`);

        // In a full implementation, this would:
        // 1. For quick tasks: directly execute via AgentRuntime
        // 2. For long tasks: spawn a sub-agent with its own context
        //
        // For now, we just log the task as a placeholder.
        // The actual execution will be connected to AgentRuntime.processMessage()
        // when the agent supports autonomous task execution.
    }

    public getStatus(): {
        running: boolean;
        intervalMinutes: number;
        lastRun?: string;
        tasksExecuted: number;
    } {
        return {
            running: this.running,
            intervalMinutes: this.intervalMs / (60 * 1000),
            lastRun: this.lastRun?.toISOString(),
            tasksExecuted: this.tasksExecuted,
        };
    }
}

// Singleton
let heartbeatManager: HeartbeatManager | null = null;

export function getHeartbeatManager(): HeartbeatManager {
    if (!heartbeatManager) {
        heartbeatManager = new HeartbeatManager();
    }
    return heartbeatManager;
}

export function createHeartbeatManager(): HeartbeatManager {
    heartbeatManager = new HeartbeatManager();
    return heartbeatManager;
}

export default HeartbeatManager;
