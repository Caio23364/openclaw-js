import { describe, it, expect, vi } from 'vitest';
import { createComposioClient } from '../src/integrations/composio.js';

describe('ComposioIntegration', () => {
    it('creates a disabled client when no API key is present', () => {
        const client = createComposioClient();
        expect(client.isEnabled()).toBe(false);
    });

    it('formats actions into valid OpenClaw simple tools', () => {
        // We mock a client with a fake key
        process.env.COMPOSIO_API_KEY = 'test_key';
        const client = createComposioClient();

        const actions = [
            {
                name: 'create_repo',
                app: 'github',
                description: 'Creates a GitHub repository',
                parameters: { type: 'object', properties: { name: { type: 'string' } } },
                tags: []
            }
        ];

        const tools = client.actionsToTools(actions as any);
        expect(tools.length).toBe(1);
        expect(tools[0].name).toBe('composio.github.create_repo');
        expect(tools[0].description).toBe('Creates a GitHub repository');
        expect(tools[0].parameters).toHaveProperty('type', 'object');

        delete process.env.COMPOSIO_API_KEY;
    });
});
