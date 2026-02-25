import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadIdentity, getIdentityPrompt } from '../src/identity/index.js';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('Identity System', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should build prompt using openclaw format (markdown files)', async () => {
        vi.mocked(fs.readFile).mockImplementation(async (file: any) => {
            if (file.includes('IDENTITY.md')) return 'I am OpenClaw.';
            if (file.includes('SOUL.md')) return 'I am helpful.';
            return '';
        });

        const prompt = await getIdentityPrompt({ format: 'openclaw' }, 'workspace-path');

        expect(prompt).toContain('I am OpenClaw.');
        expect(prompt).toContain('I am helpful.');
    });

    it('should build prompt using aieos format (JSON file)', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
            identity: { names: { first: "Alpha" }, bio: { gender: "Robot" } },
            psychology: { traits: { mbti: "INTJ" } },
            linguistics: { text_style: { formality_level: 9 } }
        }));

        const prompt = await getIdentityPrompt({ format: 'aieos', aieos_path: 'aieos.json' }, 'workspace-path');

        expect(prompt).toContain('Name: Alpha');
        expect(prompt).toContain('Gender: Robot');
        expect(prompt).toContain('MBTI: INTJ');
        expect(prompt).toContain('Formality: 9');
    });

    it('should parse inline AIEOS JSON string', async () => {
        const prompt = await getIdentityPrompt({
            format: 'aieos',
            aieos_inline: '{"identity":{"names":{"first":"Beta"}},"capabilities":{"skills":[{"name":"fast_typing"}]}}'
        });

        expect(prompt).toContain('Name: Beta');
        expect(prompt).toContain('Skills: fast_typing');
    });
});
