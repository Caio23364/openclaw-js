/**
 * Agent Runtime Tests
 * Tests for the AgentRuntime class: agent creation, session management,
 * tool registration, and message processing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies - must be before imports
vi.mock('../src/utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/gateway/index.js', () => ({
    getGateway: vi.fn(() => ({
        broadcast: vi.fn(),
        getClients: vi.fn().mockReturnValue([]),
        addAgent: vi.fn(),
        addSession: vi.fn(),
        removeSession: vi.fn(),
        updateSession: vi.fn(),
    })),
}));

vi.mock('../src/providers/index.js', () => ({
    getProviderManager: vi.fn(() => ({
        chat: vi.fn().mockResolvedValue({
            content: 'Mock AI response',
            toolCalls: [],
            usage: { input: 10, output: 20, total: 30 },
        }),
        getDefaultProvider: vi.fn().mockReturnValue({ id: 'mock', type: 'openai' }),
    })),
    createProviderManager: vi.fn().mockResolvedValue({
        chat: vi.fn().mockResolvedValue({
            content: 'Mock AI response',
            toolCalls: [],
            usage: { input: 10, output: 20, total: 30 },
        }),
    }),
}));

vi.mock('../src/utils/helpers.js', () => ({
    generateId: vi.fn().mockReturnValue('test-id-123'),
    StateStore: vi.fn().mockImplementation(() => ({
        get: vi.fn(),
        set: vi.fn(),
        save: vi.fn().mockResolvedValue(undefined),
    })),
}));

import AgentRuntime, {
    getAgentRuntime,
    createAgentRuntime,
} from '../src/agents/index.js';

describe('AgentRuntime', () => {
    let runtime: AgentRuntime;

    beforeEach(() => {
        vi.clearAllMocks();
        runtime = new AgentRuntime();
    });

    // ==================== Agent creation ====================

    describe('createAgent', () => {
        it('creates a default agent', () => {
            const agent = runtime.createAgent('default');
            expect(agent).toBeDefined();
            expect(agent.id).toBe('default');
        });

        it('creates agent with custom config', () => {
            const agent = runtime.createAgent('custom', {
                model: 'anthropic/claude-opus-4-6',
                provider: 'anthropic',
                temperature: 0.5,
            });

            expect(agent.id).toBe('custom');
            expect(agent.config.model).toBe('anthropic/claude-opus-4-6');
            expect(agent.config.provider).toBe('anthropic');
            expect(agent.config.temperature).toBe(0.5);
        });

        it('overwrites existing agent with same id', () => {
            runtime.createAgent('dup', { model: 'model-1' });
            const agent = runtime.createAgent('dup', { model: 'model-2' });
            expect(agent.config.model).toBe('model-2');
            expect(runtime.getAgents()).toHaveLength(1);
        });
    });

    // ==================== Agent retrieval ====================

    describe('getAgent', () => {
        it('returns the agent if it exists', () => {
            runtime.createAgent('find-me');
            expect(runtime.getAgent('find-me')).toBeDefined();
        });

        it('returns undefined for non-existent agent', () => {
            expect(runtime.getAgent('ghost')).toBeUndefined();
        });
    });

    describe('getAgents', () => {
        it('returns all agents', () => {
            runtime.createAgent('a');
            runtime.createAgent('b');
            runtime.createAgent('c');
            expect(runtime.getAgents()).toHaveLength(3);
        });
    });

    // ==================== Session management ====================

    describe('getOrCreateSession / getSession', () => {
        it('creates a new session', () => {
            runtime.createAgent('default');
            const session = runtime.getOrCreateSession('sess-1');
            expect(session).toBeDefined();
            expect(session.id).toBe('sess-1');
        });

        it('returns existing session on second call', () => {
            runtime.createAgent('default');
            const s1 = runtime.getOrCreateSession('sess-2');
            const s2 = runtime.getOrCreateSession('sess-2');
            expect(s1).toBe(s2);
        });

        it('getSession returns the session by id', () => {
            runtime.createAgent('default');
            runtime.getOrCreateSession('sess-3');
            expect(runtime.getSession('sess-3')).toBeDefined();
        });

        it('getSession returns undefined for unknown session', () => {
            expect(runtime.getSession('nope')).toBeUndefined();
        });
    });

    describe('getSessions', () => {
        it('lists all sessions', () => {
            runtime.createAgent('default');
            runtime.getOrCreateSession('s1');
            runtime.getOrCreateSession('s2');
            expect(runtime.getSessions()).toHaveLength(2);
        });
    });

    describe('clearSession', () => {
        it('clears the message context of a session', () => {
            runtime.createAgent('default');
            const session = runtime.getOrCreateSession('clear-me');
            session.context.push({
                id: '1',
                sessionId: 'clear-me',
                role: 'user',
                content: 'hello',
                timestamp: new Date(),
            });

            runtime.clearSession('clear-me');
            expect(runtime.getSession('clear-me')!.context).toHaveLength(0);
        });
    });

    describe('deleteSession', () => {
        it('removes the session entirely', () => {
            runtime.createAgent('default');
            runtime.getOrCreateSession('delete-me');
            runtime.deleteSession('delete-me');
            expect(runtime.getSession('delete-me')).toBeUndefined();
        });
    });

    // ==================== Tool registration ====================

    describe('registerTool / unregisterTool / getTools', () => {
        it('registers a custom tool', () => {
            const tool = {
                name: 'system.echo',
                description: 'Echoes input',
                parameters: [],
                handler: async () => ({ success: true, output: 'echo' }),
                requireApproval: false,
                category: 'system' as const,
            };

            runtime.registerTool(tool);
            const tools = runtime.getTools();
            expect(tools.some((t) => t.name === 'system.echo')).toBe(true);
        });

        it('unregisters a tool by name', () => {
            const tool = {
                name: 'system.temp',
                description: 'Temporary',
                parameters: [],
                handler: async () => ({ success: true, output: '' }),
                requireApproval: false,
                category: 'system' as const,
            };

            runtime.registerTool(tool);
            runtime.unregisterTool('system.temp');
            expect(runtime.getTools().some((t) => t.name === 'system.temp')).toBe(false);
        });

        it('getTools includes built-in tools', () => {
            const tools = runtime.getTools();
            // The runtime registers several built-in tools
            expect(tools.length).toBeGreaterThan(0);
            expect(tools.some((t) => t.name === 'system.info')).toBe(true);
        });
    });

    // ==================== Singleton ====================

    describe('createAgentRuntime / getAgentRuntime', () => {
        it('createAgentRuntime returns a new instance', () => {
            const rt = createAgentRuntime();
            expect(rt).toBeInstanceOf(AgentRuntime);
        });

        it('getAgentRuntime returns the singleton', () => {
            createAgentRuntime();
            const rt = getAgentRuntime();
            expect(rt).toBeInstanceOf(AgentRuntime);
        });
    });
});
