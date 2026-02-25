import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createComputerUseClient } from '../src/browser/computer-use.js';

describe('ComputerUseClient', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('translates native Claude computer use JSON to REST API calls', async () => {
        const client = createComputerUseClient({ endpoint: 'http://127.0.0.1:8787/v1/actions' });

        const result = await client.execute('mouse_click', { x: 500, y: 500 });

        expect(result).toBeDefined();
        expect(global.fetch).toHaveBeenCalledWith(
            'http://127.0.0.1:8787/v1/actions',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('mouse_click')
            })
        );
    });

    it('blocks actions outside of boundary guardrails', async () => {
        const client = createComputerUseClient({
            endpoint: 'http://127.0.0.1:8787/v1/actions',
            max_coordinate_x: 1000,
            max_coordinate_y: 1000
        });

        await expect(client.execute('mouse_click', { x: 1500, y: 500 }))
            .rejects.toThrow('Coordinate x=1500 outside bounds');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns an error if the sidecar is unreachable', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

        const client = createComputerUseClient({ endpoint: 'http://127.0.0.1:8787/v1/actions' });

        const result = await client.execute('keyboard_type', { text: 'hello' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to execute action');
    });
});
