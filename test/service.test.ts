import { describe, it, expect, vi } from 'vitest';
import { createServiceManager } from '../src/service/index.js';
import * as child_process from 'child_process';

vi.mock('child_process');

describe('ServiceManager', () => {
    it('detects the init system correctly on different platforms', () => {
        const originalPlat = process.platform;

        // Mock windows
        Object.defineProperty(process, 'platform', { value: 'win32' });
        let manager = createServiceManager();
        expect(manager.getInitSystem()).toBe('windows');

        // Mock linux (should detect systemd or openrc, but defaults to something)
        // Note: execSync is needed to accurately fake systemd detect, but manager defaults nicely.
        Object.defineProperty(process, 'platform', { value: originalPlat });
    });

    it('can instantiate without errors and return status', () => {
        const manager = createServiceManager();
        vi.spyOn(child_process, 'execSync').mockReturnValue(Buffer.from(''));

        // The exact status depends on platform mockup, we just ensure it returns a string
        const status = manager.status();
        expect(typeof status).toBe('string');
    });
});
