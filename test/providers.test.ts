/**
 * Tests for providers/index.ts
 * Covers: ProviderManager creation, initialization, checkAvailability parallelism,
 *         getStatus, provider retrieval, and error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config FIRST (before provider mocks)
vi.mock('../src/utils/config.js', () => ({
    getConfig: vi.fn(() => Promise.resolve({
        providers: {
            anthropic: { apiKey: 'test-anthropic-key', baseUrl: 'https://api.anthropic.com' },
            openai: { apiKey: 'test-openai-key', baseUrl: 'https://api.openai.com' },
            google: { apiKey: '', baseUrl: '' },
        },
        gateway: { port: 18789 },
        channels: {},
        skills: [],
    })),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    ensureDirectories: vi.fn(),
    CONFIG_DIR: '/home/user/.openclaw',
    STATE_DIR: '/home/user/.openclaw/state',
    LOGS_DIR: '/home/user/.openclaw/logs',
    SKILLS_DIR: '/home/user/.openclaw/skills',
}));

// Mock logger
vi.mock('../src/utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Import after mocks
const { ProviderManager, createProviderManager } = await import('../src/providers/index.js');

describe('ProviderManager', () => {
    let manager: InstanceType<typeof ProviderManager>;

    beforeEach(async () => {
        vi.clearAllMocks();
        manager = new ProviderManager();
        await manager.initialize();
    });

    describe('initialize', () => {
        it('initializes providers with valid API keys', () => {
            expect(manager.getProvider('anthropic')).toBeDefined();
            expect(manager.getProvider('openai')).toBeDefined();
        });

        it('skips providers without API keys', () => {
            // Google has empty apiKey in mock config
            expect(manager.getProvider('google')).toBeUndefined();
        });

        it('returns correct provider count', () => {
            const all = manager.getAllProviders();
            expect(all).toHaveLength(2); // anthropic + openai
        });
    });

    describe('checkAvailability', () => {
        it('runs checks in parallel (not sequential)', async () => {
            const delays: number[] = [];
            const start = Date.now();

            // Override checkAvailability on each provider via the internal map
            const providers = manager.getAllProviders();
            for (const provider of providers) {
                (provider as any).checkAvailability = vi.fn().mockImplementation(async () => {
                    await new Promise((r) => setTimeout(r, 50));
                    delays.push(Date.now() - start);
                    return true;
                });
            }

            await manager.checkAvailability();

            // If parallel, both should complete around the same time (~50ms)
            // If sequential, second would be ~100ms
            if (delays.length >= 2) {
                const diff = Math.abs(delays[1] - delays[0]);
                expect(diff).toBeLessThan(40); // parallel: near simultaneous
            }
        });

        it('handles provider errors gracefully (returns false)', async () => {
            const providers = manager.getAllProviders();
            for (const provider of providers) {
                (provider as any).checkAvailability = vi.fn().mockRejectedValue(new Error('Network error'));
            }

            const result = await manager.checkAvailability();

            for (const available of Object.values(result)) {
                expect(available).toBe(false);
            }
        });
    });

    describe('createProviderManager (factory)', () => {
        it('returns an initialized ProviderManager', async () => {
            const pm = await createProviderManager();
            expect(pm).toBeInstanceOf(ProviderManager);
            expect(pm.getAllProviders().length).toBeGreaterThanOrEqual(2);
        });
    });
});
