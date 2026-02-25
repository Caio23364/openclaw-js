import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const isWindows = process.platform === 'win32';
const localWorkers = Math.max(4, Math.min(16, os.cpus().length));
const ciWorkers = isWindows ? 2 : 3;

export default defineConfig({
    resolve: {
        alias: [
            {
                find: '@',
                replacement: path.join(repoRoot, 'src'),
            },
        ],
    },
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 30_000,
        hookTimeout: isWindows ? 60_000 : 30_000,
        unstubEnvs: true,
        unstubGlobals: true,
        pool: 'forks',
        maxWorkers: isCI ? ciWorkers : localWorkers,
        include: [
            'test/**/*.test.ts',
            'src/**/*.test.ts',
        ],
        setupFiles: ['test/setup.ts'],
        exclude: [
            'dist/**',
            '**/node_modules/**',
            '**/*.live.test.ts',
            '**/*.e2e.test.ts',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            all: false,
            include: ['./src/**/*.ts'],
            exclude: [
                'test/**',
                'src/**/*.test.ts',
                'src/index.ts',
                'src/cli/**',
            ],
        },
    },
});
