import { describe, it, expect, vi } from 'vitest';
import { createTunnelManager } from '../src/tunnel/index.js';

describe('TunnelManager', () => {
    it('initializes with default settings', () => {
        const manager = createTunnelManager({ provider: 'none' });
        expect(manager.status().running).toBe(false);
        expect(manager.status().provider).toBe('none');
    });

    it('throws error if none provider is started without custom command', async () => {
        const manager = createTunnelManager({ provider: 'none' as any });
        await expect(manager.start(8080)).rejects.toThrow('No tunnel provider configured.');
    });

    it('does not crash on stop when not running', async () => {
        const manager = createTunnelManager({ provider: 'none' });
        await expect(manager.stop()).resolves.not.toThrow();
        expect(manager.status().running).toBe(false);
    });
});
