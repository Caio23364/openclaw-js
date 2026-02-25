/**
 * Tests for browser/index.ts
 * Covers: BrowserManager concurrent closeAll, browser lifecycle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock functions at module level
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockGoto = vi.fn().mockResolvedValue(undefined);
const mockSetViewport = vi.fn().mockResolvedValue(undefined);
const mockSetUserAgent = vi.fn().mockResolvedValue(undefined);

// Mock helpers first
vi.mock('../src/utils/helpers.js', () => ({
    generateId: vi.fn(() => 'test-id-123'),
}));

// Create mock page factory
const createMockPage = () => ({
    goto: mockGoto,
    close: vi.fn(),
    evaluate: vi.fn(),
    url: vi.fn().mockReturnValue('about:blank'),
    title: vi.fn().mockResolvedValue('Test'),
    setViewport: mockSetViewport,
    setUserAgent: mockSetUserAgent,
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
    $: vi.fn(),
    $$: vi.fn().mockResolvedValue([]),
    content: vi.fn().mockResolvedValue('<html></html>'),
});

// Create mock context factory
const createMockContext = () => ({
    newPage: vi.fn().mockResolvedValue(createMockPage()),
    pages: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
});

// Create mock browser factory
const createMockBrowser = () => {
    const mockContext = createMockContext();
    return {
        newPage: vi.fn().mockResolvedValue(createMockPage()),
        close: mockClose,
        isConnected: vi.fn().mockReturnValue(true),
        pages: vi.fn().mockResolvedValue([]),
        createBrowserContext: vi.fn().mockResolvedValue(createMockContext()),
        defaultBrowserContext: vi.fn().mockReturnValue(mockContext),
    };
};

// Mock puppeteer
vi.mock('puppeteer', () => ({
    default: { launch: vi.fn(() => Promise.resolve(createMockBrowser())) },
    launch: vi.fn(() => Promise.resolve(createMockBrowser())),
}));

vi.mock('../src/utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { BrowserManager } = await import('../src/browser/index.js');

describe('BrowserManager', () => {
    let manager: InstanceType<typeof BrowserManager>;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Restore generateId mock after clearAllMocks
        const { generateId } = await import('../src/utils/helpers.js');
        (generateId as any).mockReturnValue('test-id-123');
        mockClose.mockResolvedValue(undefined);
        manager = new BrowserManager();
    });

    describe('launchBrowser', () => {
        it('creates a new browser and returns its ID', async () => {
            const id = await manager.launchBrowser({ name: 'test' });
            expect(id).toBe('test-id-123');
        });

        it('tracks the browser in sessions', async () => {
            await manager.launchBrowser({ name: 'test' });
            expect(manager.getAllSessions()).toHaveLength(1);
        });
    });

    describe('closeAll', () => {
        it('closes all browsers and clears sessions', async () => {
            await manager.launchBrowser({ name: 'test' });
            expect(manager.getAllSessions()).toHaveLength(1);

            await manager.closeAll();
            expect(manager.getAllSessions()).toHaveLength(0);
        });

        it('handles individual close errors gracefully', async () => {
            // Create a new manager to isolate this test
            const testManager = new BrowserManager();
            
            // Mock a browser that fails on close
            const puppeteer = await import('puppeteer');
            const failingBrowser = {
                newPage: vi.fn().mockResolvedValue(createMockPage()),
                close: vi.fn().mockRejectedValue(new Error('Close failed')),
                isConnected: vi.fn().mockReturnValue(true),
                pages: vi.fn().mockResolvedValue([]),
                defaultBrowserContext: vi.fn().mockReturnValue(createMockContext()),
            };

            (puppeteer.default.launch as any).mockResolvedValueOnce(failingBrowser);
            await testManager.launchBrowser({ name: 'test' });

            // Should not throw even if individual close fails
            await expect(testManager.closeAll()).resolves.not.toThrow();
        });
    });

    describe('navigate', () => {
        it('navigates browser to URL', async () => {
            const id = await manager.launchBrowser({ name: 'test' });
            await manager.navigate(id, 'https://example.com');
            expect(mockGoto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
        });

        it('throws for unknown browser ID', async () => {
            await expect(manager.navigate('nonexistent', 'https://example.com'))
                .rejects.toThrow('Browser not found');
        });
    });
});
