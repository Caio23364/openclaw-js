/**
 * OpenClaw - Memory System
 * Persistent agent memory with SQLite, Markdown, and None backends.
 * Supports keyword search, vector similarity (when embeddings available),
 * and agent tools for save/recall/search/forget.
 * Based on ZeroClaw's Memory System.
 */

import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { log } from '../utils/logger.js';
import { WORKSPACE_DIR } from '../utils/config.js';

// ── Types ──

export type MemoryBackendType = 'sqlite' | 'markdown' | 'none';

export interface MemoryConfig {
    /** Memory backend to use */
    backend: MemoryBackendType;
    /** Automatically save memory after agent interactions */
    auto_save: boolean;
    /** Weight for vector (embedding) similarity in search (0-1) */
    vector_weight: number;
    /** Weight for keyword matching in search (0-1) */
    keyword_weight: number;
    /** Embedding provider: "none", "openai", "custom:https://..." */
    embedding_provider: string;
    /** Directory for markdown-based memory storage */
    storage_dir: string;
    /** SQLite database path */
    sqlite_path: string;
}

export interface MemoryEntry {
    id: string;
    key: string;
    content: string;
    metadata: Record<string, any>;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
    accessCount: number;
    relevanceScore?: number;
}

export interface SearchOptions {
    limit?: number;
    tags?: string[];
    minScore?: number;
    dateRange?: { from?: Date; to?: Date };
}

const DEFAULT_CONFIG: MemoryConfig = {
    backend: 'markdown',
    auto_save: true,
    vector_weight: 0.7,
    keyword_weight: 0.3,
    embedding_provider: 'none',
    storage_dir: join(WORKSPACE_DIR, '.openclaw', 'memory'),
    sqlite_path: join(WORKSPACE_DIR, '.openclaw', 'memory.db'),
};

// ── Memory Backend Interface ──

interface MemoryBackend {
    save(key: string, content: string, metadata?: Record<string, any>, tags?: string[]): Promise<MemoryEntry>;
    recall(query: string, limit?: number): Promise<MemoryEntry[]>;
    search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
    get(key: string): Promise<MemoryEntry | null>;
    delete(key: string): Promise<boolean>;
    list(limit?: number, offset?: number): Promise<MemoryEntry[]>;
    count(): Promise<number>;
    clear(): Promise<void>;
}

// ── Keyword Search Utilities ──

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2);
}

function calculateKeywordScore(query: string, content: string): number {
    const queryTokens = new Set(tokenize(query));
    const contentTokens = tokenize(content);

    if (queryTokens.size === 0 || contentTokens.length === 0) return 0;

    const contentSet = new Set(contentTokens);
    let matches = 0;
    for (const qt of queryTokens) {
        if (contentSet.has(qt)) matches++;
    }

    return matches / queryTokens.size;
}

function generateId(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

// ── None Backend (no-op) ──

class NoneBackend implements MemoryBackend {
    async save(): Promise<MemoryEntry> {
        return { id: '', key: '', content: '', metadata: {}, tags: [], createdAt: new Date(), updatedAt: new Date(), accessCount: 0 };
    }
    async recall(): Promise<MemoryEntry[]> { return []; }
    async search(): Promise<MemoryEntry[]> { return []; }
    async get(): Promise<null> { return null; }
    async delete(): Promise<boolean> { return false; }
    async list(): Promise<MemoryEntry[]> { return []; }
    async count(): Promise<number> { return 0; }
    async clear(): Promise<void> { }
}

// ── Markdown Backend ──

class MarkdownBackend implements MemoryBackend {
    private dir: string;

    constructor(dir: string) {
        this.dir = dir;
    }

    private async ensureDir(): Promise<void> {
        await mkdir(this.dir, { recursive: true });
    }

    private entryPath(key: string): string {
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
        return join(this.dir, `${safeKey}.md`);
    }

    async save(key: string, content: string, metadata: Record<string, any> = {}, tags: string[] = []): Promise<MemoryEntry> {
        await this.ensureDir();

        const entry: MemoryEntry = {
            id: generateId(key),
            key,
            content,
            metadata,
            tags,
            createdAt: new Date(),
            updatedAt: new Date(),
            accessCount: 0,
        };

        // Check if exists — preserve createdAt and accessCount
        const existing = await this.get(key);
        if (existing) {
            entry.createdAt = existing.createdAt;
            entry.accessCount = existing.accessCount;
        }

        const markdown = this.entryToMarkdown(entry);
        await writeFile(this.entryPath(key), markdown, 'utf-8');

        return entry;
    }

    async recall(query: string, limit = 10): Promise<MemoryEntry[]> {
        return this.search(query, { limit });
    }

    async search(query: string, options: SearchOptions = {}): Promise<MemoryEntry[]> {
        const entries = await this.list(1000);
        const limit = options.limit || 10;
        const minScore = options.minScore || 0.1;

        const scored = entries
            .map((entry) => {
                const score = calculateKeywordScore(query, `${entry.key} ${entry.content} ${entry.tags.join(' ')}`);
                return { ...entry, relevanceScore: score };
            })
            .filter((e) => e.relevanceScore >= minScore);

        // Apply tag filter
        let filtered = scored;
        if (options.tags?.length) {
            filtered = scored.filter((e) =>
                options.tags!.some((tag) => e.tags.includes(tag))
            );
        }

        // Apply date range filter
        if (options.dateRange) {
            if (options.dateRange.from) {
                filtered = filtered.filter((e) => e.createdAt >= options.dateRange!.from!);
            }
            if (options.dateRange.to) {
                filtered = filtered.filter((e) => e.createdAt <= options.dateRange!.to!);
            }
        }

        return filtered
            .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
            .slice(0, limit);
    }

    async get(key: string): Promise<MemoryEntry | null> {
        try {
            const content = await readFile(this.entryPath(key), 'utf-8');
            const entry = this.markdownToEntry(content, key);
            if (entry) {
                // Increment access count
                entry.accessCount++;
                const markdown = this.entryToMarkdown(entry);
                await writeFile(this.entryPath(key), markdown, 'utf-8');
            }
            return entry;
        } catch {
            return null;
        }
    }

    async delete(key: string): Promise<boolean> {
        try {
            await unlink(this.entryPath(key));
            return true;
        } catch {
            return false;
        }
    }

    async list(limit = 100, offset = 0): Promise<MemoryEntry[]> {
        await this.ensureDir();

        try {
            const files = await readdir(this.dir);
            const mdFiles = files.filter((f) => f.endsWith('.md')).slice(offset, offset + limit);

            const entries: MemoryEntry[] = [];
            for (const file of mdFiles) {
                try {
                    const content = await readFile(join(this.dir, file), 'utf-8');
                    const key = basename(file, '.md');
                    const entry = this.markdownToEntry(content, key);
                    if (entry) entries.push(entry);
                } catch {
                    // Skip corrupt files
                }
            }

            return entries;
        } catch {
            return [];
        }
    }

    async count(): Promise<number> {
        await this.ensureDir();
        try {
            const files = await readdir(this.dir);
            return files.filter((f) => f.endsWith('.md')).length;
        } catch {
            return 0;
        }
    }

    async clear(): Promise<void> {
        await this.ensureDir();
        const files = await readdir(this.dir);
        for (const file of files) {
            if (file.endsWith('.md')) {
                await unlink(join(this.dir, file));
            }
        }
    }

    // ── Markdown serialization ──

    private entryToMarkdown(entry: MemoryEntry): string {
        const frontmatter = [
            '---',
            `id: ${entry.id}`,
            `key: ${entry.key}`,
            `tags: [${entry.tags.join(', ')}]`,
            `created: ${entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt}`,
            `updated: ${new Date().toISOString()}`,
            `access_count: ${entry.accessCount}`,
        ];

        if (Object.keys(entry.metadata).length > 0) {
            frontmatter.push(`metadata: ${JSON.stringify(entry.metadata)}`);
        }

        frontmatter.push('---', '');

        return [...frontmatter, entry.content, ''].join('\n');
    }

    private markdownToEntry(markdown: string, key: string): MemoryEntry | null {
        const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!fmMatch) {
            return {
                id: generateId(key),
                key,
                content: markdown.trim(),
                metadata: {},
                tags: [],
                createdAt: new Date(),
                updatedAt: new Date(),
                accessCount: 0,
            };
        }

        const frontmatter = fmMatch[1];
        const content = fmMatch[2].trim();

        const getValue = (name: string): string => {
            const match = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
            return match ? match[1].trim() : '';
        };

        const tagsStr = getValue('tags');
        const tagsMatch = tagsStr.match(/\[([^\]]*)\]/);
        const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean) : [];

        let metadata: Record<string, any> = {};
        try {
            const metaStr = getValue('metadata');
            if (metaStr) metadata = JSON.parse(metaStr);
        } catch { }

        return {
            id: getValue('id') || generateId(key),
            key: getValue('key') || key,
            content,
            metadata,
            tags,
            createdAt: new Date(getValue('created') || Date.now()),
            updatedAt: new Date(getValue('updated') || Date.now()),
            accessCount: parseInt(getValue('access_count') || '0'),
        };
    }
}

// ── SQLite Backend ──

class SQLiteBackend implements MemoryBackend {
    private dbPath: string;
    private db: any = null;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    private async getDb(): Promise<any> {
        if (this.db) return this.db;

        try {
            // Dynamic import for better-sqlite3 (optional dependency)
            const dbModule = 'better-sqlite3';
            const Database = (await import(/* webpackIgnore: true */ dbModule)).default;
            this.db = new Database(this.dbPath);

            // Create tables
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT DEFAULT '{}',
          tags TEXT DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          access_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
        CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
      `);

            return this.db;
        } catch (error) {
            log.error('SQLite not available. Install better-sqlite3: npm install better-sqlite3');
            throw error;
        }
    }

    async save(key: string, content: string, metadata: Record<string, any> = {}, tags: string[] = []): Promise<MemoryEntry> {
        const db = await this.getDb();
        const id = generateId(key);
        const now = new Date().toISOString();

        const existing = db.prepare('SELECT * FROM memories WHERE key = ?').get(key);

        if (existing) {
            db.prepare(`
        UPDATE memories SET content = ?, metadata = ?, tags = ?, updated_at = ?
        WHERE key = ?
      `).run(content, JSON.stringify(metadata), JSON.stringify(tags), now, key);
        } else {
            db.prepare(`
        INSERT INTO memories (id, key, content, metadata, tags, created_at, updated_at, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(id, key, content, JSON.stringify(metadata), JSON.stringify(tags), now, now);
        }

        return {
            id,
            key,
            content,
            metadata,
            tags,
            createdAt: existing ? new Date(existing.created_at) : new Date(now),
            updatedAt: new Date(now),
            accessCount: existing ? existing.access_count : 0,
        };
    }

    async recall(query: string, limit = 10): Promise<MemoryEntry[]> {
        return this.search(query, { limit });
    }

    async search(query: string, options: SearchOptions = {}): Promise<MemoryEntry[]> {
        const db = await this.getDb();
        const limit = options.limit || 10;
        const rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all();

        const scored = rows
            .map((row: any) => {
                const entry = this.rowToEntry(row);
                entry.relevanceScore = calculateKeywordScore(query, `${entry.key} ${entry.content} ${entry.tags.join(' ')}`);
                return entry;
            })
            .filter((e: MemoryEntry) => e.relevanceScore! >= (options.minScore || 0.1));

        let filtered = scored;
        if (options.tags?.length) {
            filtered = scored.filter((e: MemoryEntry) =>
                options.tags!.some((tag) => e.tags.includes(tag))
            );
        }

        return filtered
            .sort((a: MemoryEntry, b: MemoryEntry) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
            .slice(0, limit);
    }

    async get(key: string): Promise<MemoryEntry | null> {
        const db = await this.getDb();
        const row = db.prepare('SELECT * FROM memories WHERE key = ?').get(key);
        if (!row) return null;

        // Increment access count
        db.prepare('UPDATE memories SET access_count = access_count + 1 WHERE key = ?').run(key);

        return this.rowToEntry(row);
    }

    async delete(key: string): Promise<boolean> {
        const db = await this.getDb();
        const result = db.prepare('DELETE FROM memories WHERE key = ?').run(key);
        return result.changes > 0;
    }

    async list(limit = 100, offset = 0): Promise<MemoryEntry[]> {
        const db = await this.getDb();
        const rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
        return rows.map((r: any) => this.rowToEntry(r));
    }

    async count(): Promise<number> {
        const db = await this.getDb();
        const row = db.prepare('SELECT COUNT(*) as count FROM memories').get() as any;
        return row.count;
    }

    async clear(): Promise<void> {
        const db = await this.getDb();
        db.prepare('DELETE FROM memories').run();
    }

    private rowToEntry(row: any): MemoryEntry {
        return {
            id: row.id,
            key: row.key,
            content: row.content,
            metadata: JSON.parse(row.metadata || '{}'),
            tags: JSON.parse(row.tags || '[]'),
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            accessCount: row.access_count || 0,
        };
    }
}

// ── Memory Manager ──

export class MemoryManager {
    private backend: MemoryBackend;
    private config: MemoryConfig;

    constructor(config?: Partial<MemoryConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        switch (this.config.backend) {
            case 'sqlite':
                this.backend = new SQLiteBackend(this.config.sqlite_path);
                break;
            case 'markdown':
                this.backend = new MarkdownBackend(this.config.storage_dir);
                break;
            case 'none':
            default:
                this.backend = new NoneBackend();
                break;
        }

        log.info(`Memory system initialized: backend=${this.config.backend}`);
    }

    // ── Agent-facing tools ──

    /**
     * Save a memory entry. Agent tool: memory.save
     */
    async save(key: string, content: string, metadata?: Record<string, any>, tags?: string[]): Promise<MemoryEntry> {
        const entry = await this.backend.save(key, content, metadata, tags);
        log.info(`Memory saved: "${key}" (${content.length} chars)`);
        return entry;
    }

    /**
     * Recall memories matching a query. Agent tool: memory.recall
     */
    async recall(query: string, limit = 5): Promise<MemoryEntry[]> {
        const entries = await this.backend.recall(query, limit);
        log.info(`Memory recall: "${query}" → ${entries.length} results`);
        return entries;
    }

    /**
     * Search memories with advanced options. Agent tool: memory.search
     */
    async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
        return this.backend.search(query, options);
    }

    /**
     * Get a specific memory by key. Agent tool: memory.get
     */
    async get(key: string): Promise<MemoryEntry | null> {
        return this.backend.get(key);
    }

    /**
     * Delete a memory. Agent tool: memory.forget
     */
    async forget(key: string): Promise<boolean> {
        const result = await this.backend.delete(key);
        if (result) log.info(`Memory forgotten: "${key}"`);
        return result;
    }

    /**
     * List all memories.
     */
    async list(limit = 100, offset = 0): Promise<MemoryEntry[]> {
        return this.backend.list(limit, offset);
    }

    /**
     * Get total count of memories.
     */
    async count(): Promise<number> {
        return this.backend.count();
    }

    /**
     * Clear all memories.
     */
    async clear(): Promise<void> {
        await this.backend.clear();
        log.info('Memory cleared');
    }

    /**
     * Get memory tools for agent registration.
     */
    getTools(): Array<{ name: string; description: string; parameters: Record<string, any> }> {
        return [
            {
                name: 'memory.save',
                description: 'Save information to long-term memory for future reference',
                parameters: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'Unique key/name for this memory' },
                        content: { type: 'string', description: 'Content to remember' },
                        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
                    },
                    required: ['key', 'content'],
                },
            },
            {
                name: 'memory.recall',
                description: 'Recall memories related to a topic or question',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'What to recall' },
                        limit: { type: 'number', description: 'Max results (default 5)' },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'memory.search',
                description: 'Search memories with filtering options',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query' },
                        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
                        limit: { type: 'number', description: 'Max results' },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'memory.forget',
                description: 'Delete a specific memory by key',
                parameters: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'Key of the memory to forget' },
                    },
                    required: ['key'],
                },
            },
        ];
    }

    getConfig(): MemoryConfig {
        return { ...this.config };
    }
}

// Singleton
let memoryManager: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
    if (!memoryManager) {
        memoryManager = new MemoryManager();
    }
    return memoryManager;
}

export function createMemoryManager(config?: Partial<MemoryConfig>): MemoryManager {
    memoryManager = new MemoryManager(config);
    return memoryManager;
}

export default MemoryManager;
