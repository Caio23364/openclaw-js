/**
 * Tests for utils/config.ts
 * Covers: ensureDirectories, loadConfig, saveConfig, getConfig,
 *         caching behavior, exported constants
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

// Mock fs/promises before imports
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock('fs/promises', () => ({
    readFile: (...args: any[]) => mockReadFile(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    mkdir: (...args: any[]) => mockMkdir(...args),
}));

// Mock the logger to avoid side effects
vi.mock('../src/utils/logger.js', () => ({
    log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

const CONFIG_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const STATE_DIR = join(CONFIG_DIR, 'state');
const LOGS_DIR = join(CONFIG_DIR, 'logs');
const SKILLS_DIR = join(CONFIG_DIR, 'skills');

describe('config.ts', () => {
    // Re-import the module for each test to reset the cached state
    let configModule: typeof import('../src/utils/config.js');

    beforeEach(async () => {
        vi.clearAllMocks();
        mockMkdir.mockResolvedValue(undefined);
        mockWriteFile.mockResolvedValue(undefined);

        // Reset module to clear cached config between tests
        vi.resetModules();

        // Re-mock after reset
        vi.doMock('fs/promises', () => ({
            readFile: (...args: any[]) => mockReadFile(...args),
            writeFile: (...args: any[]) => mockWriteFile(...args),
            mkdir: (...args: any[]) => mockMkdir(...args),
        }));
        vi.doMock('../src/utils/logger.js', () => ({
            log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        }));

        configModule = await import('../src/utils/config.js');
    });

    // ── ensureDirectories ───────────────────────────────────────────────
    describe('ensureDirectories', () => {
        it('creates all required directories with recursive flag', async () => {
            await configModule.ensureDirectories();

            expect(mockMkdir).toHaveBeenCalledTimes(4);
            const dirs = mockMkdir.mock.calls.map((c: any[]) => c[0]);
            expect(dirs).toContain(CONFIG_DIR);
            expect(dirs).toContain(STATE_DIR);
            expect(dirs).toContain(LOGS_DIR);
            expect(dirs).toContain(SKILLS_DIR);

            // Each call should use { recursive: true }
            for (const call of mockMkdir.mock.calls) {
                expect(call[1]).toEqual({ recursive: true });
            }
        });
    });

    // ── loadConfig ──────────────────────────────────────────────────────
    describe('loadConfig', () => {
        it('returns default config when file does not exist (ENOENT)', async () => {
            const enoent = Object.assign(new Error('File not found'), { code: 'ENOENT' });
            mockReadFile.mockRejectedValue(enoent);

            const config = await configModule.loadConfig();

            expect(config).toBeDefined();
            expect(config.gateway).toBeDefined();
            expect(config.gateway.port).toBe(18789);
            // Should save the default config
            expect(mockWriteFile).toHaveBeenCalled();
        });

        it('merges file config with defaults', async () => {
            mockReadFile.mockResolvedValue(JSON.stringify({
                gateway: { port: 9999 },
                skills: ['custom-skill'],
            }));

            const config = await configModule.loadConfig();

            expect(config.gateway.port).toBe(9999);
            expect(config.skills).toEqual(['custom-skill']);
            // Default values still present
            expect(config.channels).toBeDefined();
        });

        it('caches config on subsequent calls (no extra disk reads)', async () => {
            mockReadFile.mockResolvedValue(JSON.stringify({ skills: [] }));

            await configModule.loadConfig();
            await configModule.loadConfig();
            await configModule.loadConfig();

            // readFile should only be called once (cache hit afterwards)
            expect(mockReadFile).toHaveBeenCalledTimes(1);
        });

        it('returns defaults on parse error', async () => {
            mockReadFile.mockResolvedValue('not-json!!!');

            const config = await configModule.loadConfig();

            expect(config).toBeDefined();
            expect(config.gateway.port).toBe(18789);
        });
    });

    // ── getConfig (async cached getter) ─────────────────────────────────
    describe('getConfig', () => {
        it('returns cached config after loadConfig', async () => {
            mockReadFile.mockResolvedValue(JSON.stringify({ skills: ['a'] }));
            await configModule.loadConfig();

            const config = await configModule.getConfig();
            expect(config.skills).toEqual(['a']);
        });
    });

    // ── saveConfig ──────────────────────────────────────────────────────
    describe('saveConfig', () => {
        it('writes JSON to disk with formatting', async () => {
            const testConfig = { gateway: { port: 1234 } };
            await configModule.saveConfig(testConfig as any);

            expect(mockWriteFile).toHaveBeenCalledWith(
                CONFIG_FILE,
                JSON.stringify(testConfig, null, 2)
            );
        });
    });

    // ── Exported constants ──────────────────────────────────────────────
    describe('exported constants', () => {
        it('CONFIG_DIR points to ~/.openclaw', () => {
            expect(configModule.CONFIG_DIR).toBe(CONFIG_DIR);
        });

        it('STATE_DIR is inside CONFIG_DIR', () => {
            expect(configModule.STATE_DIR).toContain('.openclaw');
            expect(configModule.STATE_DIR).toContain('state');
        });
    });
});
