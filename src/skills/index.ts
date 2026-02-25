/**
 * OpenClaw - Skills Module
 * Skills platform with ClawHub integration.
 * Skills are SKILL.md files in the workspace that define agent capabilities.
 *
 * Skills registry: https://clawhub.ai / https://github.com/openclaw/skills
 */

import { readFile, readdir, writeFile, mkdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { log } from '../utils/logger.js';

// ==================== TYPES ====================

export interface SkillMeta {
    name: string;
    description: string;
    version?: string;
    author?: string;
    tags?: string[];
    /** Remote URL this skill was fetched from (e.g. ClawHub ID). */
    source?: string;
}

export interface Skill {
    /** Directory name (slug), e.g. "my-research-skill". */
    slug: string;
    /** Parsed front-matter metadata from SKILL.md. */
    meta: SkillMeta;
    /** Full markdown body (instructions). */
    body: string;
    /** Absolute path to the skill directory. */
    path: string;
    /** Whether the skill is currently enabled. */
    enabled: boolean;
}

export interface ClawHubSearchResult {
    name: string;
    slug: string;
    description: string;
    author: string;
    version: string;
    downloadUrl: string;
}

// ==================== SKILL PARSER ====================

/**
 * Parses a SKILL.md file and extracts YAML front-matter + body.
 */
export function parseSkillFile(content: string): { meta: SkillMeta; body: string } {
    const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(fmRegex);

    let meta: SkillMeta = { name: 'Untitled Skill', description: '' };
    let body = content;

    if (match) {
        const fmBlock = match[1];
        body = content.slice(match[0].length).trim();

        // Simple YAML key-value parser (no dependency needed)
        for (const line of fmBlock.split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');

            switch (key) {
                case 'name':
                    meta.name = value;
                    break;
                case 'description':
                    meta.description = value;
                    break;
                case 'version':
                    meta.version = value;
                    break;
                case 'author':
                    meta.author = value;
                    break;
                case 'tags':
                    meta.tags = value
                        .replace(/^\[|\]$/g, '')
                        .split(',')
                        .map((t) => t.trim().replace(/^["']|["']$/g, ''));
                    break;
                case 'source':
                    meta.source = value;
                    break;
            }
        }
    }

    return { meta, body };
}

// ==================== SKILL MANAGER ====================

export class SkillManager {
    private skills: Map<string, Skill> = new Map();
    private workspaceRoot: string;
    private skillsDir: string;
    private initialized = false;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = resolve(workspaceRoot);
        this.skillsDir = join(this.workspaceRoot, 'skills');
    }

    /**
     * Scan the workspace skills directory and load all SKILL.md files.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await mkdir(this.skillsDir, { recursive: true });
        } catch {
            // Already exists or permission error — we'll handle below.
        }

        try {
            const entries = await readdir(this.skillsDir, { withFileTypes: true });
            const dirs = entries.filter((e) => e.isDirectory());

            const loadPromises = dirs.map(async (dir) => {
                try {
                    const skillMdPath = join(this.skillsDir, dir.name, 'SKILL.md');
                    const content = await readFile(skillMdPath, 'utf-8');
                    const { meta, body } = parseSkillFile(content);

                    const skill: Skill = {
                        slug: dir.name,
                        meta,
                        body,
                        path: join(this.skillsDir, dir.name),
                        enabled: true,
                    };

                    this.skills.set(dir.name, skill);
                } catch (error) {
                    log.debug(`Skipping directory ${dir.name}: no valid SKILL.md`);
                }
            });

            await Promise.all(loadPromises);
            this.initialized = true;
            log.info(`Loaded ${this.skills.size} skill(s) from workspace`);
        } catch (error) {
            log.error('Failed to scan skills directory:', error);
            this.initialized = true;
        }
    }

    /**
     * Get all loaded skills.
     */
    getAll(): Skill[] {
        return [...this.skills.values()];
    }

    /**
     * Get a single skill by slug.
     */
    get(slug: string): Skill | undefined {
        return this.skills.get(slug);
    }

    /**
     * Enable / disable a skill at runtime.
     */
    setEnabled(slug: string, enabled: boolean): boolean {
        const skill = this.skills.get(slug);
        if (!skill) return false;
        skill.enabled = enabled;
        return true;
    }

    /**
     * Get only the enabled skills.
     */
    getEnabled(): Skill[] {
        return [...this.skills.values()].filter((s) => s.enabled);
    }

    /**
     * Install a skill from raw SKILL.md content.
     */
    async install(slug: string, content: string): Promise<Skill> {
        const dir = join(this.skillsDir, slug);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'SKILL.md'), content, 'utf-8');

        const { meta, body } = parseSkillFile(content);
        const skill: Skill = { slug, meta, body, path: dir, enabled: true };
        this.skills.set(slug, skill);
        log.info(`Installed skill: ${meta.name} (${slug})`);
        return skill;
    }

    /**
     * Uninstall (remove from memory — file cleanup is caller's responsibility).
     */
    uninstall(slug: string): boolean {
        return this.skills.delete(slug);
    }

    /**
     * Build the combined skills prompt for injection into the agent system prompt.
     * This follows OpenClaw's pattern of `~/.openclaw/workspace/skills/<skill>/SKILL.md`.
     */
    buildSkillsPrompt(): string {
        const enabled = this.getEnabled();
        if (enabled.length === 0) return '';

        const parts = enabled.map(
            (s) => `## Skill: ${s.meta.name}\n${s.meta.description ? `> ${s.meta.description}\n` : ''}\n${s.body}`,
        );

        return `\n<skills>\n${parts.join('\n\n---\n\n')}\n</skills>`;
    }
}

// ==================== CLAWHUB CLIENT ====================

const CLAWHUB_API_BASE = 'https://clawhub.ai';

/**
 * Search ClawHub for skills matching a query.
 * ClawHub is a fast skill registry for agents, with vector search.
 */
export async function searchClawHub(query: string): Promise<ClawHubSearchResult[]> {
    try {
        const url = `${CLAWHUB_API_BASE}/api/search?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'openclaw-js' },
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            log.warn(`ClawHub search failed: HTTP ${response.status}`);
            return [];
        }

        const data = (await response.json()) as { results?: ClawHubSearchResult[] };
        return data.results ?? [];
    } catch (error) {
        log.warn('ClawHub search error:', error);
        return [];
    }
}

/**
 * Fetch a single skill's SKILL.md content from the openclaw/skills GitHub repo.
 */
export async function fetchSkillFromGitHub(slug: string): Promise<string | null> {
    try {
        const url = `https://raw.githubusercontent.com/openclaw/skills/main/skills/${slug}/SKILL.md`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'openclaw-js' },
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) return null;
        return await response.text();
    } catch (error) {
        log.warn(`Failed to fetch skill ${slug} from GitHub:`, error);
        return null;
    }
}

// ==================== SINGLETON ====================

let skillManager: SkillManager | null = null;

export function getSkillManager(): SkillManager {
    if (!skillManager) {
        throw new Error('SkillManager not initialized — call createSkillManager() first');
    }
    return skillManager;
}

export function createSkillManager(workspaceRoot: string): SkillManager {
    skillManager = new SkillManager(workspaceRoot);
    return skillManager;
}

export default SkillManager;
