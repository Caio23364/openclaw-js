import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager, createMemoryManager } from '../src/memory/index.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

describe('MemoryManager (Markdown)', () => {
    let dbPath: string;
    let manager: MemoryManager;

    beforeEach(async () => {
        dbPath = path.join(os.tmpdir(), `openclaw-test-memory-${Date.now()}`);
        await fs.mkdir(dbPath, { recursive: true });
        manager = createMemoryManager({ backend: 'markdown', storage_dir: dbPath });
    });

    afterEach(async () => {
        if (manager) await manager.clear();
        try { await fs.rm(dbPath, { recursive: true, force: true }); } catch (e) { }
    });

    it('should save and recall memory', async () => {
        const entry = await manager.save('user_prefs', 'User likes dark mode', {}, ['preferences']);
        expect(entry.id).toBeDefined();

        const recalled = await manager.recall('user_prefs');
        expect(recalled.length).toBeGreaterThan(0);
        expect(recalled[0].content).toBe('User likes dark mode');
    });

    it('should search memory by content', async () => {
        await manager.save('pref1', 'User likes dark mode', {}, ['prefs']);
        await manager.save('plan1', 'Tomorrow we will launch the rocket', {}, ['plans']);

        const results = await manager.search('dark mode', { limit: 5 });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain('dark mode');
        expect(results[0].key).toBe('pref1');
    });

    it('should filter search by tags', async () => {
        await manager.save('pref1', 'Python is the language', {}, ['tech', 'python']);
        await manager.save('note1', 'I saw a python snake', {}, ['nature']);

        const results = await manager.search('python', { tags: ['tech'] });
        expect(results.length).toBe(1);
        expect(results[0].key).toBe('pref1');
    });

    it('should return empty array for non-existent recall', async () => {
        const recalled = await manager.recall('does_not_exist_xyz123abc');
        expect(recalled.length).toBe(0);
    });

    it('should increment access count on get', async () => {
        await manager.save('test_count', 'Content inside');
        await manager.get('test_count');
        await manager.get('test_count');

        const entry = await manager.get('test_count');
        expect(entry?.accessCount).toBeGreaterThanOrEqual(2);
    });
});
