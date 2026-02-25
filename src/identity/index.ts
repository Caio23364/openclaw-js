/**
 * OpenClaw - Identity System
 * Supports OpenClaw markdown files (IDENTITY.md, SOUL.md, etc.)
 * and AIEOS v1.1 JSON format for portable AI identity.
 * Based on ZeroClaw's identity system.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { WORKSPACE_DIR } from '../utils/config.js';

// ── Types ──

export type IdentityFormat = 'openclaw' | 'aieos';

export interface IdentityConfig {
    format: IdentityFormat;
    /** Path to AIEOS JSON file (relative to workspace or absolute) */
    aieos_path?: string;
    /** Inline AIEOS JSON string */
    aieos_inline?: string;
}

export interface AIEOSIdentity {
    identity?: {
        names?: { first?: string; last?: string; nickname?: string };
        bio?: { gender?: string; age_biological?: number };
        origin?: { nationality?: string; birthplace?: { city?: string } };
    };
    psychology?: {
        neural_matrix?: Record<string, number>;
        traits?: { mbti?: string; ocean?: Record<string, number> };
        moral_compass?: { alignment?: string; core_values?: string[] };
    };
    linguistics?: {
        text_style?: { formality_level?: number; style_descriptors?: string[] };
        idiolect?: { catchphrases?: string[]; forbidden_words?: string[] };
    };
    motivations?: {
        core_drive?: string;
        goals?: { short_term?: string[]; long_term?: string[] };
    };
    capabilities?: {
        skills?: { name: string }[];
        tools?: string[];
    };
}

// ── Markdown Identity Loader (OpenClaw format) ──

const IDENTITY_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'AGENTS.md'];

/**
 * Load OpenClaw-format markdown identity files from workspace.
 */
async function loadMarkdownIdentity(workspace: string): Promise<string> {
    const parts: string[] = [];

    for (const file of IDENTITY_FILES) {
        try {
            const content = await readFile(join(workspace, file), 'utf-8');
            if (content.trim()) {
                parts.push(`## ${file.replace('.md', '')}\n${content.trim()}`);
            }
        } catch {
            // File doesn't exist — skip silently
        }
    }

    return parts.join('\n\n');
}

// ── AIEOS Parser ──

/**
 * Parse AIEOS v1.1 JSON into a system prompt segment.
 */
function parseAIEOS(data: AIEOSIdentity): string {
    const lines: string[] = ['## Identity (AIEOS)'];

    // Identity
    if (data.identity) {
        const id = data.identity;
        if (id.names) {
            const name = [id.names.first, id.names.last].filter(Boolean).join(' ');
            if (name) lines.push(`Name: ${name}`);
            if (id.names.nickname) lines.push(`Nickname: ${id.names.nickname}`);
        }
        if (id.bio) {
            if (id.bio.gender) lines.push(`Gender: ${id.bio.gender}`);
            if (id.bio.age_biological) lines.push(`Age: ${id.bio.age_biological}`);
        }
        if (id.origin?.nationality) lines.push(`Nationality: ${id.origin.nationality}`);
    }

    // Psychology
    if (data.psychology) {
        const psych = data.psychology;
        if (psych.traits?.mbti) lines.push(`MBTI: ${psych.traits.mbti}`);
        if (psych.moral_compass?.alignment) lines.push(`Alignment: ${psych.moral_compass.alignment}`);
        if (psych.moral_compass?.core_values?.length) {
            lines.push(`Core Values: ${psych.moral_compass.core_values.join(', ')}`);
        }
        if (psych.neural_matrix) {
            const traits = Object.entries(psych.neural_matrix)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            lines.push(`Neural: ${traits}`);
        }
    }

    // Linguistics
    if (data.linguistics) {
        const ling = data.linguistics;
        if (ling.text_style?.style_descriptors?.length) {
            lines.push(`Style: ${ling.text_style.style_descriptors.join(', ')}`);
        }
        if (ling.text_style?.formality_level !== undefined) {
            lines.push(`Formality: ${ling.text_style.formality_level}`);
        }
        if (ling.idiolect?.catchphrases?.length) {
            lines.push(`Catchphrases: ${ling.idiolect.catchphrases.join('; ')}`);
        }
        if (ling.idiolect?.forbidden_words?.length) {
            lines.push(`Avoid saying: ${ling.idiolect.forbidden_words.join(', ')}`);
        }
    }

    // Motivations
    if (data.motivations) {
        if (data.motivations.core_drive) {
            lines.push(`Core Drive: ${data.motivations.core_drive}`);
        }
        if (data.motivations.goals?.short_term?.length) {
            lines.push(`Short-term Goals: ${data.motivations.goals.short_term.join('; ')}`);
        }
        if (data.motivations.goals?.long_term?.length) {
            lines.push(`Long-term Goals: ${data.motivations.goals.long_term.join('; ')}`);
        }
    }

    // Capabilities
    if (data.capabilities?.skills?.length) {
        lines.push(`Skills: ${data.capabilities.skills.map((s) => s.name).join(', ')}`);
    }

    return lines.join('\n');
}

/**
 * Load AIEOS identity from file or inline JSON.
 */
async function loadAIEOSIdentity(config: IdentityConfig, workspace: string): Promise<string> {
    let data: AIEOSIdentity;

    if (config.aieos_inline) {
        try {
            data = JSON.parse(config.aieos_inline);
        } catch (error) {
            log.error('Failed to parse inline AIEOS JSON:', error);
            return '';
        }
    } else if (config.aieos_path) {
        try {
            const fullPath = config.aieos_path.startsWith('/')
                ? config.aieos_path
                : join(workspace, config.aieos_path);
            const content = await readFile(fullPath, 'utf-8');
            data = JSON.parse(content);
        } catch (error) {
            log.error(`Failed to load AIEOS file ${config.aieos_path}:`, error);
            return '';
        }
    } else {
        return '';
    }

    return parseAIEOS(data);
}

// ── Public API ──

/**
 * Load identity based on configured format.
 * Returns a string to prepend to the agent's system prompt.
 */
export async function loadIdentity(config: IdentityConfig, workspace?: string): Promise<string> {
    const ws = workspace || WORKSPACE_DIR;

    try {
        if (config.format === 'aieos') {
            const identity = await loadAIEOSIdentity(config, ws);
            if (identity) {
                log.info('Loaded AIEOS identity');
                return identity;
            }
        }

        // Default: OpenClaw markdown format
        const identity = await loadMarkdownIdentity(ws);
        if (identity) {
            log.info(`Loaded markdown identity (${IDENTITY_FILES.length} files checked)`);
            return identity;
        }

        return '';
    } catch (error) {
        log.error('Failed to load identity:', error);
        return '';
    }
}

/**
 * Get identity prompt for injection into agent context.
 * Wraps the identity in a clear delimiter for the model.
 */
export async function getIdentityPrompt(config: IdentityConfig, workspace?: string): Promise<string> {
    const identity = await loadIdentity(config, workspace);
    if (!identity) return '';

    return `<identity>\n${identity}\n</identity>\n\n`;
}

export default { loadIdentity, getIdentityPrompt, parseAIEOS };
