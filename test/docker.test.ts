import { describe, it, expect, vi } from 'vitest';
import { createDockerRuntime } from '../src/runtime/docker.js';
import * as child_process from 'child_process';

vi.mock('child_process');

describe('DockerRuntime', () => {
    it('executes command inside a docker container', async () => {
        const mockSpawn = vi.spyOn(child_process, 'spawn').mockImplementation((command, args, options) => {
            const mockProcess = new child_process.ChildProcess();
            setTimeout(() => {
                mockProcess.emit('exit', 0);
            }, 10);

            // Need to mock stdout/stderr events
            mockProcess.stdout = { on: vi.fn((event, cb) => { if (event === 'data') cb(Buffer.from('hello from docker\n')); }) } as any;
            mockProcess.stderr = { on: vi.fn() } as any;
            mockProcess.on = vi.fn((event, cb) => { if (event === 'exit') setTimeout(() => cb(0), 10); }) as any;
            mockProcess.kill = vi.fn() as any;

            return mockProcess as any;
        });

        const runtime = createDockerRuntime({ image: 'node:18', memory_limit_mb: 512, cpu_limit: 1 });
        vi.spyOn(runtime, 'isAvailable').mockResolvedValue(true);

        const result = await runtime.execute('echo "hello"');

        expect(result.stdout.trim()).toBe('hello from docker');
        expect(result.exitCode).toBe(0);
        expect(mockSpawn).toHaveBeenCalled();

        const callArgs = mockSpawn.mock.calls[0][1] as string[];
        expect(callArgs.join(' ')).toContain('--memory 512m');
        expect(callArgs.join(' ')).toContain('node:18');
    });

    it('handles execution errors', async () => {
        vi.spyOn(child_process, 'spawn').mockImplementation((command, args, options) => {
            const mockProcess = new child_process.ChildProcess();
            setTimeout(() => {
                mockProcess.emit('exit', 1);
            }, 10);

            mockProcess.stdout = { on: vi.fn() } as any;
            mockProcess.stderr = { on: vi.fn((event, cb) => { if (event === 'data') cb(Buffer.from('error output\n')); }) } as any;
            mockProcess.on = vi.fn((event, cb) => { if (event === 'exit') setTimeout(() => cb(1), 10); }) as any;
            mockProcess.kill = vi.fn() as any;

            return mockProcess as any;
        });

        const runtime = createDockerRuntime({ image: 'alpine' });
        vi.spyOn(runtime, 'isAvailable').mockResolvedValue(true);
        const result = await runtime.execute('invalidcmd');

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('error output');
    });
});
