#!/usr/bin/env node
/**
 * OpenClaw CLI Binary
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import and run the CLI
import('../dist/cli/index.js').catch((error) => {
  console.error('Failed to load CLI:', error);
  process.exit(1);
});
