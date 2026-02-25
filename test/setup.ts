/**
 * OpenClaw - Test Setup
 * Global test setup file for Vitest, modeled after the upstream OpenClaw project.
 * Runs before every test file.
 */

import { afterEach, vi } from 'vitest';

// Automatically restore all mocks after each test to prevent cross-test pollution.
afterEach(() => {
    vi.restoreAllMocks();
});
