/**
 * Skills Module Tests
 * Tests for SKILL.md parsing, SkillManager, and ClawHub integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('fs/promises', () => ({
    readFile: vi.fn(),
    readdir: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { parseSkillFile, SkillManager } from '../src/skills/index.js';

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

// ==================== parseSkillFile ====================

describe('parseSkillFile', () => {
    it('parses YAML front-matter and body', () => {
        const content = `---
name: My Skill
description: A test skill
version: 1.0.0
author: tester
---
# Instructions
Do the thing.`;

        const { meta, body } = parseSkillFile(content);
        expect(meta.name).toBe('My Skill');
        expect(meta.description).toBe('A test skill');
        expect(meta.version).toBe('1.0.0');
        expect(meta.author).toBe('tester');
        expect(body).toBe('# Instructions\nDo the thing.');
    });

    it('handles missing front-matter', () => {
        const content = '# Just markdown\nHello';
        const { meta, body } = parseSkillFile(content);
        expect(meta.name).toBe('Untitled Skill');
        expect(meta.description).toBe('');
        expect(body).toBe(content);
    });

    it('parses tags from front-matter', () => {
        const content = `---
name: Tagged Skill
description: Has tags
tags: [coding, productivity, "ai tools"]
---
Body here.`;

        const { meta } = parseSkillFile(content);
        expect(meta.tags).toEqual(['coding', 'productivity', 'ai tools']);
    });

    it('strips quotes from values', () => {
        const content = `---
name: "Quoted Name"
description: 'Quoted Description'
---
Body.`;

        const { meta } = parseSkillFile(content);
        expect(meta.name).toBe('Quoted Name');
        expect(meta.description).toBe('Quoted Description');
    });

    it('handles source field', () => {
        const content = `---
name: Remote Skill
description: Fetched remotely
source: clawhub://my-skill
---
Body text.`;

        const { meta } = parseSkillFile(content);
        expect(meta.source).toBe('clawhub://my-skill');
    });
});

// ==================== SkillManager ====================

describe('SkillManager', () => {
    let manager: SkillManager;

    beforeEach(() => {
        vi.clearAllMocks();
        mockMkdir.mockResolvedValue(undefined);
        manager = new SkillManager('/home/user/.openclaw/workspace');
    });

    describe('initialize', () => {
        it('creates the skills directory on first init', async () => {
            mockReaddir.mockResolvedValue([] as any);
            await manager.initialize();
            expect(mockMkdir).toHaveBeenCalledWith(
                expect.stringContaining('skills'),
                { recursive: true },
            );
        });

        it('loads SKILL.md files from subdirectories', async () => {
            mockReaddir.mockResolvedValue([
                { name: 'research', isDirectory: () => true, isFile: () => false },
                { name: 'coding', isDirectory: () => true, isFile: () => false },
                { name: 'README.md', isDirectory: () => false, isFile: () => true },
            ] as any);

            mockReadFile.mockImplementation(async (path: any) => {
                if (String(path).includes('research')) {
                    return `---\nname: Research Helper\ndescription: Helps with research\n---\nDo research things.`;
                }
                if (String(path).includes('coding')) {
                    return `---\nname: Code Assistant\ndescription: Coding help\n---\nWrite code.`;
                }
                throw new Error('File not found');
            });

            await manager.initialize();
            expect(manager.getAll()).toHaveLength(2);
            expect(manager.get('research')?.meta.name).toBe('Research Helper');
            expect(manager.get('coding')?.meta.name).toBe('Code Assistant');
        });

        it('skips directories without SKILL.md', async () => {
            mockReaddir.mockResolvedValue([
                { name: 'broken', isDirectory: () => true, isFile: () => false },
            ] as any);

            mockReadFile.mockRejectedValue(new Error('ENOENT'));

            await manager.initialize();
            expect(manager.getAll()).toHaveLength(0);
        });

        it('is idempotent (only runs once)', async () => {
            mockReaddir.mockResolvedValue([] as any);
            await manager.initialize();
            await manager.initialize();
            expect(mockReaddir).toHaveBeenCalledTimes(1);
        });
    });

    describe('get / getAll / getEnabled', () => {
        beforeEach(async () => {
            mockReaddir.mockResolvedValue([
                { name: 'skill-a', isDirectory: () => true, isFile: () => false },
                { name: 'skill-b', isDirectory: () => true, isFile: () => false },
            ] as any);

            mockReadFile.mockImplementation(async (path: any) => {
                if (String(path).includes('skill-a')) {
                    return `---\nname: Skill A\ndescription: First\n---\nBody A`;
                }
                return `---\nname: Skill B\ndescription: Second\n---\nBody B`;
            });

            await manager.initialize();
        });

        it('getAll returns all skills', () => {
            expect(manager.getAll()).toHaveLength(2);
        });

        it('get returns a specific skill by slug', () => {
            const skill = manager.get('skill-a');
            expect(skill).toBeDefined();
            expect(skill!.meta.name).toBe('Skill A');
        });

        it('get returns undefined for unknown slug', () => {
            expect(manager.get('nonexistent')).toBeUndefined();
        });

        it('getEnabled returns only enabled skills', () => {
            manager.setEnabled('skill-b', false);
            const enabled = manager.getEnabled();
            expect(enabled).toHaveLength(1);
            expect(enabled[0].slug).toBe('skill-a');
        });
    });

    describe('setEnabled', () => {
        beforeEach(async () => {
            mockReaddir.mockResolvedValue([
                { name: 'skill-x', isDirectory: () => true, isFile: () => false },
            ] as any);
            mockReadFile.mockResolvedValue(`---\nname: X\ndescription: test\n---\nBody`);
            await manager.initialize();
        });

        it('returns true when toggling a known skill', () => {
            expect(manager.setEnabled('skill-x', false)).toBe(true);
            expect(manager.get('skill-x')!.enabled).toBe(false);
        });

        it('returns false for unknown slug', () => {
            expect(manager.setEnabled('nope', true)).toBe(false);
        });
    });

    describe('install', () => {
        it('writes SKILL.md and registers the skill', async () => {
            mockWriteFile.mockResolvedValue(undefined);

            const content = `---\nname: New Skill\ndescription: Just installed\n---\nInstructions here.`;
            const skill = await manager.install('new-skill', content);

            expect(mockMkdir).toHaveBeenCalled();
            expect(mockWriteFile).toHaveBeenCalledWith(
                expect.stringContaining('SKILL.md'),
                content,
                'utf-8',
            );
            expect(skill.slug).toBe('new-skill');
            expect(skill.meta.name).toBe('New Skill');
            expect(manager.get('new-skill')).toBeDefined();
        });
    });

    describe('uninstall', () => {
        beforeEach(async () => {
            mockReaddir.mockResolvedValue([
                { name: 'removable', isDirectory: () => true, isFile: () => false },
            ] as any);
            mockReadFile.mockResolvedValue(`---\nname: Removable\ndescription: test\n---\nBody`);
            await manager.initialize();
        });

        it('removes the skill from memory', () => {
            expect(manager.uninstall('removable')).toBe(true);
            expect(manager.get('removable')).toBeUndefined();
        });

        it('returns false for unknown slug', () => {
            expect(manager.uninstall('unknown')).toBe(false);
        });
    });

    describe('buildSkillsPrompt', () => {
        it('returns empty string when no skills are enabled', async () => {
            mockReaddir.mockResolvedValue([] as any);
            await manager.initialize();
            expect(manager.buildSkillsPrompt()).toBe('');
        });

        it('builds a combined prompt for enabled skills', async () => {
            mockReaddir.mockResolvedValue([
                { name: 'alpha', isDirectory: () => true, isFile: () => false },
            ] as any);
            mockReadFile.mockResolvedValue(
                `---\nname: Alpha Skill\ndescription: Does alpha things\n---\nStep 1: Do X.\nStep 2: Do Y.`,
            );
            await manager.initialize();

            const prompt = manager.buildSkillsPrompt();
            expect(prompt).toContain('<skills>');
            expect(prompt).toContain('## Skill: Alpha Skill');
            expect(prompt).toContain('Does alpha things');
            expect(prompt).toContain('Step 1: Do X.');
            expect(prompt).toContain('</skills>');
        });
    });
});
