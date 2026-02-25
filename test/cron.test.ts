import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CronManager, createCronManager } from '../src/cron/index.js';

describe('CronManager', () => {
    let cronManager: CronManager;

    beforeEach(() => {
        cronManager = createCronManager();
    });

    afterEach(() => {
        cronManager.stopAll();
    });

    it('should create and retrieve a job', () => {
        const job = cronManager.createJob('test-job', '* * * * *', {
            type: 'message',
            target: 'user1',
            payload: { text: 'hello' }
        });

        expect(job.name).toBe('test-job');
        expect(cronManager.getJob(job.id)).toBeDefined();
        expect(cronManager.getJobs().length).toBe(1);
    });

    it('should allow pausing and resuming a job', () => {
        const job = cronManager.createJob('pause-test', '* * * * *', {
            type: 'message',
            target: 'user1',
            payload: {}
        });

        expect(job.enabled).toBe(true);

        cronManager.pauseJob(job.id);
        const pausedJob = cronManager.getJob(job.id);
        expect(pausedJob?.enabled).toBe(false);

        cronManager.resumeJob(job.id);
        const resumedJob = cronManager.getJob(job.id);
        expect(resumedJob?.enabled).toBe(true);
    });

    it('should update a job', () => {
        const job = cronManager.createJob('update-test', '* * * * *', {
            type: 'message',
            target: 'user1',
            payload: {}
        });

        cronManager.updateJob(job.id, { name: 'updated-name', schedule: '*/5 * * * *' });

        const updated = cronManager.getJob(job.id);
        expect(updated?.name).toBe('updated-name');
        expect(updated?.schedule).toBe('*/5 * * * *');
    });

    it('should delete a job', () => {
        const job = cronManager.createJob('delete-test', '* * * * *', {
            type: 'message',
            target: 'user1',
            payload: {}
        });

        cronManager.deleteJob(job.id);
        expect(cronManager.getJob(job.id)).toBeUndefined();
        expect(cronManager.getJobs().length).toBe(0);
    });
});
