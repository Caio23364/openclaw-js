/**
 * OpenClaw - Cron System (Extended)
 * Scheduled tasks with add-at, add-every, once, pause/resume, update support.
 * Based on ZeroClaw's extended cron system.
 */

import cron from 'node-cron';
import { log } from '../utils/logger.js';
import { getGateway } from '../gateway/index.js';
import { CronJob, CronAction } from '../types/index.js';
import { generateId, StateStore } from '../utils/helpers.js';

// ── Interval parser ──

const INTERVAL_REGEX = /^(\d+)(s|m|h|d|w)$/;

function parseInterval(interval: string): number {
  const match = interval.match(INTERVAL_REGEX);
  if (!match) throw new Error(`Invalid interval format: ${interval}. Use e.g. "30s", "5m", "1h", "1d"`);

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown interval unit: ${unit}`);
  }
}

export class CronManager {
  private jobs: Map<string, { job: CronJob; task: cron.ScheduledTask | null; timer?: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> }>;
  private stateStore: StateStore;

  constructor() {
    this.jobs = new Map();
    this.stateStore = new StateStore('cron');
    this.loadJobs();
  }

  private loadJobs(): void {
    const savedJobs = this.stateStore.get<CronJob[]>('jobs', []) ?? [];
    for (const job of savedJobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
    log.info(`Loaded ${savedJobs.length} cron jobs`);
  }

  private saveJobs(): void {
    const jobs = Array.from(this.jobs.values()).map((j) => j.job);
    this.stateStore.set('jobs', jobs);
  }

  // ── Standard cron scheduling ──

  public createJob(
    name: string,
    schedule: string,
    action: CronAction,
    options: { timezone?: string; enabled?: boolean } = {}
  ): CronJob {
    const job: CronJob = {
      id: generateId(),
      name,
      schedule,
      timezone: options.timezone,
      enabled: options.enabled ?? true,
      action,
      runCount: 0,
      errorCount: 0,
      createdAt: new Date(),
    };

    if (job.enabled) {
      this.scheduleJob(job);
    } else {
      this.jobs.set(job.id, { job, task: null });
    }

    this.saveJobs();
    log.info(`Created cron job: ${name} (${schedule})`);
    return job;
  }

  private scheduleJob(job: CronJob): void {
    if (!cron.validate(job.schedule)) {
      log.error(`Invalid cron schedule: ${job.schedule}`);
      return;
    }

    const task = cron.schedule(
      job.schedule,
      async () => {
        await this.executeJob(job);
      },
      { scheduled: true, timezone: job.timezone }
    );

    this.jobs.set(job.id, { job, task });
    log.info(`Scheduled job: ${job.name}`);
  }

  // ── Extended: addAt (one-time at specific datetime) ──

  /**
   * Schedule a one-time job at a specific date/time.
   * The job is auto-deleted after execution.
   */
  public addAt(
    name: string,
    date: Date,
    action: CronAction,
    options: { timezone?: string } = {}
  ): CronJob {
    const delayMs = date.getTime() - Date.now();
    if (delayMs <= 0) {
      throw new Error(`Scheduled date must be in the future. Got: ${date.toISOString()}`);
    }

    const job: CronJob = {
      id: generateId(),
      name,
      schedule: `@at ${date.toISOString()}`,
      timezone: options.timezone,
      enabled: true,
      action,
      runCount: 0,
      errorCount: 0,
      createdAt: new Date(),
    };

    const timer = setTimeout(async () => {
      await this.executeJob(job);
      // Auto-delete after execution
      this.deleteJob(job.id);
      log.info(`One-time job completed and removed: ${name}`);
    }, delayMs);

    this.jobs.set(job.id, { job, task: null, timer });
    this.saveJobs();
    log.info(`Scheduled one-time job: ${name} at ${date.toISOString()} (in ${Math.round(delayMs / 1000)}s)`);
    return job;
  }

  // ── Extended: addEvery (interval-based) ──

  /**
   * Schedule a recurring job at a fixed interval.
   * @param interval Format: "30s", "5m", "1h", "1d", "1w"
   */
  public addEvery(
    name: string,
    interval: string,
    action: CronAction
  ): CronJob {
    const intervalMs = parseInterval(interval);

    const job: CronJob = {
      id: generateId(),
      name,
      schedule: `@every ${interval}`,
      enabled: true,
      action,
      runCount: 0,
      errorCount: 0,
      createdAt: new Date(),
    };

    const timer = setInterval(async () => {
      await this.executeJob(job);
    }, intervalMs);

    this.jobs.set(job.id, { job, task: null, timer });
    this.saveJobs();
    log.info(`Scheduled interval job: ${name} every ${interval}`);
    return job;
  }

  // ── Extended: once (auto-delete after first run) ──

  /**
   * Schedule a job that runs once at the next matching cron time, then deletes itself.
   */
  public once(
    name: string,
    schedule: string,
    action: CronAction,
    options: { timezone?: string } = {}
  ): CronJob {
    const job: CronJob = {
      id: generateId(),
      name,
      schedule,
      timezone: options.timezone,
      enabled: true,
      action,
      runCount: 0,
      errorCount: 0,
      createdAt: new Date(),
    };

    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }

    const task = cron.schedule(
      schedule,
      async () => {
        await this.executeJob(job);
        // Auto-delete after first execution
        this.deleteJob(job.id);
        log.info(`Once-job completed and removed: ${name}`);
      },
      { scheduled: true, timezone: options.timezone }
    );

    this.jobs.set(job.id, { job, task });
    this.saveJobs();
    log.info(`Scheduled once-job: ${name} (${schedule})`);
    return job;
  }

  // ── Extended: pause / resume ──

  public pauseJob(jobId: string): void {
    const entry = this.jobs.get(jobId);
    if (!entry) {
      log.warn(`Job not found: ${jobId}`);
      return;
    }

    entry.job.enabled = false;
    if (entry.task) entry.task.stop();
    if (entry.timer) {
      clearInterval(entry.timer as any);
      clearTimeout(entry.timer as any);
    }

    this.saveJobs();
    log.info(`Paused cron job: ${entry.job.name}`);
  }

  public resumeJob(jobId: string): void {
    const entry = this.jobs.get(jobId);
    if (!entry) {
      log.warn(`Job not found: ${jobId}`);
      return;
    }

    entry.job.enabled = true;

    // Re-schedule based on type
    if (entry.task) {
      entry.task.start();
    } else if (entry.job.schedule.startsWith('@every ')) {
      const interval = entry.job.schedule.replace('@every ', '');
      const intervalMs = parseInterval(interval);
      entry.timer = setInterval(async () => {
        await this.executeJob(entry.job);
      }, intervalMs);
    }

    this.saveJobs();
    log.info(`Resumed cron job: ${entry.job.name}`);
  }

  // ── Extended: update ──

  /**
   * Update an existing job's properties (name, schedule, action).
   */
  public updateJob(
    jobId: string,
    updates: { name?: string; schedule?: string; action?: CronAction }
  ): CronJob | undefined {
    const entry = this.jobs.get(jobId);
    if (!entry) {
      log.warn(`Job not found: ${jobId}`);
      return undefined;
    }

    // Stop the existing task
    if (entry.task) entry.task.stop();
    if (entry.timer) {
      clearInterval(entry.timer as any);
      clearTimeout(entry.timer as any);
    }

    // Apply updates
    if (updates.name) entry.job.name = updates.name;
    if (updates.action) entry.job.action = updates.action;
    if (updates.schedule) entry.job.schedule = updates.schedule;

    // Re-schedule if enabled
    if (entry.job.enabled && !entry.job.schedule.startsWith('@')) {
      this.scheduleJob(entry.job);
    }

    this.saveJobs();
    log.info(`Updated cron job: ${entry.job.name}`);
    return entry.job;
  }

  // ── Job execution ──

  private async executeJob(job: CronJob): Promise<void> {
    log.info(`Executing cron job: ${job.name}`);

    try {
      job.lastRun = new Date();
      job.runCount++;

      switch (job.action.type) {
        case 'message':
          await this.executeMessageAction(job.action);
          break;
        case 'command':
          await this.executeCommandAction(job.action);
          break;
        case 'webhook':
          await this.executeWebhookAction(job.action);
          break;
        case 'skill':
          await this.executeSkillAction(job.action);
          break;
        default:
          log.warn(`Unknown action type: ${job.action.type}`);
      }

      getGateway().publish('cron', {
        type: 'cron:executed',
        timestamp: new Date(),
        source: 'cron',
        payload: { job, success: true },
      });
    } catch (error) {
      log.error(`Cron job execution error for ${job.name}:`, error);
      job.errorCount++;

      getGateway().publish('cron', {
        type: 'cron:executed',
        timestamp: new Date(),
        source: 'cron',
        payload: { job, success: false, error: String(error) },
      });
    } finally {
      this.saveJobs();
    }
  }

  private async executeMessageAction(action: CronAction): Promise<void> {
    const { target, payload } = action;
    log.info(`Sending scheduled message to ${target}`);
  }

  private async executeCommandAction(action: CronAction): Promise<void> {
    const { payload } = action;
    log.info(`Executing command: ${payload.command}`);
  }

  private async executeWebhookAction(action: CronAction): Promise<void> {
    const { target, payload } = action;
    log.info(`Calling webhook: ${target}`);

    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  private async executeSkillAction(action: CronAction): Promise<void> {
    const { target, payload } = action;
    log.info(`Executing skill: ${target}`);
  }

  // ── Standard operations ──

  public enableJob(jobId: string): void {
    this.resumeJob(jobId);
  }

  public disableJob(jobId: string): void {
    this.pauseJob(jobId);
  }

  public deleteJob(jobId: string): void {
    const entry = this.jobs.get(jobId);
    if (entry) {
      if (entry.task) entry.task.stop();
      if (entry.timer) {
        clearInterval(entry.timer as any);
        clearTimeout(entry.timer as any);
      }
      this.jobs.delete(jobId);
      this.saveJobs();
      log.info(`Deleted cron job: ${entry.job.name}`);
    }
  }

  public getJob(jobId: string): CronJob | undefined {
    return this.jobs.get(jobId)?.job;
  }

  public getJobs(): CronJob[] {
    return Array.from(this.jobs.values()).map((entry) => entry.job);
  }

  public async runJobNow(jobId: string): Promise<void> {
    const entry = this.jobs.get(jobId);
    if (entry) {
      await this.executeJob(entry.job);
    }
  }

  public stopAll(): void {
    for (const [, entry] of this.jobs) {
      if (entry.task) entry.task.stop();
      if (entry.timer) {
        clearInterval(entry.timer as any);
        clearTimeout(entry.timer as any);
      }
      log.info(`Stopped cron job: ${entry.job.name}`);
    }
  }

  public startAll(): void {
    for (const [, entry] of this.jobs) {
      if (entry.job.enabled) {
        if (entry.task) entry.task.start();
        log.info(`Started cron job: ${entry.job.name}`);
      }
    }
  }
}

// Singleton
let cronManager: CronManager | null = null;

export function getCronManager(): CronManager {
  if (!cronManager) {
    cronManager = new CronManager();
  }
  return cronManager;
}

export function createCronManager(): CronManager {
  cronManager = new CronManager();
  return cronManager;
}

export default CronManager;
