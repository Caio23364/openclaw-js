import { describe, it, expect } from 'vitest';
import { AutonomyManager, createAutonomyManager } from '../src/autonomy/index.js';

describe('AutonomyManager', () => {
    it('creates a readonly manager by default', () => {
        const manager = createAutonomyManager({ level: 'readonly' });
        expect(manager.canExecuteCommand('ls').allowed).toBe(false);
        expect(manager.canAccessPath('/some/path').allowed).toBe(false);
    });

    it('allows specific commands in supervised mode', () => {
        const manager = createAutonomyManager({
            level: 'supervised',
            allowed_commands: ['ls', 'cat'],
            forbidden_paths: []
        });

        expect(manager.canExecuteCommand('ls -la').allowed).toBe(true);
        expect(manager.canExecuteCommand('rm -rf').allowed).toBe(false);
    });

    it('allows all commands but blocks forbidden paths in full mode', () => {
        const manager = createAutonomyManager({
            level: 'full',
            allowed_commands: [], // Ignored in full mode
            forbidden_paths: ['/etc', '/var'],
            workspace_only: false // Needed so we can test arbitrary allow/block
        });

        expect(manager.canExecuteCommand('rm -rf').allowed).toBe(true);
        expect(manager.canAccessPath('/etc/passwd').allowed).toBe(false);
        expect(manager.canAccessPath('/home/user/file').allowed).toBe(true);
    });

    it('blocks directory traversal attempts in path access', () => {
        const manager = createAutonomyManager({
            level: 'supervised',
            allowed_commands: [],
            forbidden_paths: ['/etc'],
            workspace_only: false
        });

        expect(manager.canAccessPath('/home/user/../../etc/passwd').allowed).toBe(false);
    });
});
