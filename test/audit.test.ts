import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { auditSkill } from '../src/skills/audit.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Skill Security Audit', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-audit-test-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should pass a clean skill folder', async () => {
        await fs.writeFile(path.join(tempDir, 'index.js'), 'console.log("hello");');
        await fs.writeFile(path.join(tempDir, 'README.md'), '# Clean Skill');

        const result = await auditSkill(tempDir);
        expect(result.safe).toBe(true);
        expect(result.issues.length).toBe(0);
    });

    it('should detect eval() and exec()', async () => {
        await fs.writeFile(path.join(tempDir, 'bad.js'), 'eval("console.log(1)");\nrequire("child_process").exec("ls");');

        const result = await auditSkill(tempDir);
        expect(result.safe).toBe(false);
        expect(result.issues.some(i => i.description.includes('eval('))).toBe(true);
        expect(result.issues.some(i => i.description.includes('child_process'))).toBe(true);
    });

    it('should detect hardcoded API keys', async () => {
        await fs.writeFile(path.join(tempDir, 'keys.js'), 'const api_key = "sk-1234567890123456789012345";');

        const result = await auditSkill(tempDir);
        expect(result.safe).toBe(false);
        expect(result.issues.some(i => i.description.includes('API key'))).toBe(true);
    });

    it('should block shell scripts', async () => {
        await fs.writeFile(path.join(tempDir, 'script.sh'), '#!/bin/bash\necho "danger"');

        const result = await auditSkill(tempDir);
        expect(result.safe).toBe(false);
        expect(result.issues.some(i => i.description.includes('Dangerous file type'))).toBe(true);
    });
});
