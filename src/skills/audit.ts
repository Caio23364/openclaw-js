/**
 * OpenClaw - Skills Security Audit
 * Static security scanner for skill packages.
 * Blocks symlinks, script files, unsafe markdown patterns, and shell payloads.
 * Based on ZeroClaw's skill security audit.
 */

import { readdir, lstat, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { log } from '../utils/logger.js';

// ── Types ──

export interface AuditResult {
    safe: boolean;
    skillPath: string;
    issues: AuditIssue[];
    filesScanned: number;
}

export interface AuditIssue {
    severity: 'critical' | 'high' | 'medium' | 'low';
    file: string;
    description: string;
    line?: number;
}

// ── Dangerous patterns ──

const DANGEROUS_EXTENSIONS = new Set([
    '.sh', '.bash', '.bat', '.cmd', '.ps1', '.psm1',
    '.exe', '.dll', '.so', '.dylib',
    '.py', '.rb', '.pl',  // Script languages in skill context
]);

const DANGEROUS_FILENAMES = new Set([
    'Makefile', 'Dockerfile', 'docker-compose.yml',
    '.env', '.npmrc', '.yarnrc',
    'package.json',  // Could include postinstall scripts
]);

/** Regex patterns for unsafe content in markdown/text files */
const UNSAFE_CONTENT_PATTERNS: Array<{ pattern: RegExp; description: string; severity: AuditIssue['severity'] }> = [
    { pattern: /eval\s*\(/, description: 'eval() call detected', severity: 'critical' },
    { pattern: /exec\s*\(/, description: 'exec() call detected', severity: 'critical' },
    { pattern: /child_process/, description: 'child_process module reference', severity: 'critical' },
    { pattern: /require\s*\(\s*['"`]child_process/, description: 'Importing child_process', severity: 'critical' },
    { pattern: /process\.env/, description: 'Environment variable access', severity: 'high' },
    { pattern: /\bsudo\b/, description: 'sudo command found', severity: 'high' },
    { pattern: /curl\s+.*\|\s*(ba)?sh/, description: 'Pipe-to-shell pattern (curl | sh)', severity: 'critical' },
    { pattern: /wget\s+.*\|\s*(ba)?sh/, description: 'Pipe-to-shell pattern (wget | sh)', severity: 'critical' },
    { pattern: /rm\s+-rf\s+[/~]/, description: 'Dangerous rm -rf with root/home path', severity: 'critical' },
    { pattern: /chmod\s+[0-7]*7[0-7]*/, description: 'World-writable permissions', severity: 'high' },
    { pattern: /\bpassword\s*[:=]\s*['"]\w+/, description: 'Hardcoded password', severity: 'critical' },
    { pattern: /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]/, description: 'Hardcoded API key', severity: 'critical' },
    { pattern: /sk-[A-Za-z0-9]{20,}/, description: 'OpenAI API key pattern', severity: 'critical' },
    { pattern: /\bFetch\s*\(.*\bwindow\b/, description: 'Browser fetch with window context', severity: 'medium' },
    { pattern: /document\.cookie/, description: 'Cookie access', severity: 'high' },
    { pattern: /localStorage/, description: 'LocalStorage access', severity: 'medium' },
    { pattern: /\.\.\/\.\.\//, description: 'Path traversal pattern', severity: 'high' },
    { pattern: /\x00/, description: 'Null byte injection', severity: 'critical' },
];

/** Unsafe link patterns in markdown */
const UNSAFE_MARKDOWN_LINKS: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /\[.*\]\(javascript:/, description: 'JavaScript protocol in markdown link' },
    { pattern: /\[.*\]\(data:/, description: 'Data URI in markdown link' },
    { pattern: /\[.*\]\(vbscript:/, description: 'VBScript protocol in markdown link' },
    { pattern: /!\[.*\]\(https?:\/\/.*\.(exe|bat|sh|ps1|py)\)/, description: 'Executable URL disguised as image' },
];

// ── Audit Functions ──

/**
 * Audit a skill directory for security issues.
 */
export async function auditSkill(skillPath: string): Promise<AuditResult> {
    const issues: AuditIssue[] = [];
    let filesScanned = 0;

    try {
        await scanDirectory(skillPath, skillPath, issues, (count) => { filesScanned = count; });
    } catch (error) {
        issues.push({
            severity: 'critical',
            file: skillPath,
            description: `Failed to scan directory: ${error}`,
        });
    }

    const result: AuditResult = {
        safe: !issues.some((i) => i.severity === 'critical' || i.severity === 'high'),
        skillPath,
        issues,
        filesScanned,
    };

    if (result.safe) {
        log.info(`Skill audit passed: ${skillPath} (${filesScanned} files, ${issues.length} low/medium issues)`);
    } else {
        log.warn(`Skill audit FAILED: ${skillPath} (${issues.filter((i) => i.severity === 'critical').length} critical, ${issues.filter((i) => i.severity === 'high').length} high issues)`);
    }

    return result;
}

async function scanDirectory(
    dir: string,
    rootDir: string,
    issues: AuditIssue[],
    updateCount: (count: number) => void,
    count = 0
): Promise<number> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.replace(rootDir, '').replace(/^[/\\]/, '');

        // 1. Check for symlinks
        const stats = await lstat(fullPath);
        if (stats.isSymbolicLink()) {
            issues.push({
                severity: 'critical',
                file: relativePath,
                description: 'Symlink detected — potential path escape',
            });
            continue;
        }

        if (entry.isDirectory()) {
            // Skip node_modules and .git
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            count = await scanDirectory(fullPath, rootDir, issues, updateCount, count);
            continue;
        }

        count++;
        updateCount(count);

        const ext = extname(entry.name).toLowerCase();
        const name = basename(entry.name);

        // 2. Check dangerous file extensions
        if (DANGEROUS_EXTENSIONS.has(ext)) {
            issues.push({
                severity: 'high',
                file: relativePath,
                description: `Dangerous file type: ${ext}`,
            });
        }

        // 3. Check dangerous filenames
        if (DANGEROUS_FILENAMES.has(name)) {
            issues.push({
                severity: 'medium',
                file: relativePath,
                description: `Potentially dangerous file: ${name}`,
            });
        }

        // 4. Scan text file contents
        const textExts = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.ts', '.jsx', '.tsx', '.mjs']);
        if (textExts.has(ext)) {
            try {
                const content = await readFile(fullPath, 'utf-8');
                const lines = content.split('\n');

                // Check unsafe content patterns
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    for (const check of UNSAFE_CONTENT_PATTERNS) {
                        if (check.pattern.test(line)) {
                            issues.push({
                                severity: check.severity,
                                file: relativePath,
                                description: check.description,
                                line: i + 1,
                            });
                        }
                    }

                    // Check unsafe markdown links
                    if (ext === '.md') {
                        for (const link of UNSAFE_MARKDOWN_LINKS) {
                            if (link.pattern.test(line)) {
                                issues.push({
                                    severity: 'critical',
                                    file: relativePath,
                                    description: link.description,
                                    line: i + 1,
                                });
                            }
                        }
                    }
                }

                // 5. Check for large files (> 1MB in skill = suspicious)
                if (stats.size > 1024 * 1024) {
                    issues.push({
                        severity: 'medium',
                        file: relativePath,
                        description: `Large file (${(stats.size / 1024 / 1024).toFixed(1)}MB) — unusual for skill content`,
                    });
                }
            } catch {
                // Binary file or unreadable — skip
            }
        }
    }

    return count;
}

/**
 * Format audit result for display.
 */
export function formatAuditResult(result: AuditResult): string {
    const lines: string[] = [];

    if (result.safe) {
        lines.push(`✅ Skill audit PASSED (${result.filesScanned} files scanned)`);
    } else {
        lines.push(`❌ Skill audit FAILED (${result.filesScanned} files scanned)`);
    }

    if (result.issues.length === 0) {
        lines.push('  No issues found.');
    } else {
        const grouped = {
            critical: result.issues.filter((i) => i.severity === 'critical'),
            high: result.issues.filter((i) => i.severity === 'high'),
            medium: result.issues.filter((i) => i.severity === 'medium'),
            low: result.issues.filter((i) => i.severity === 'low'),
        };

        for (const [severity, issues] of Object.entries(grouped)) {
            if (issues.length === 0) continue;
            const icon = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : severity === 'medium' ? '🟡' : '🔵';
            lines.push(`\n  ${icon} ${severity.toUpperCase()} (${issues.length}):`);
            for (const issue of issues) {
                const loc = issue.line ? `:${issue.line}` : '';
                lines.push(`    • ${issue.file}${loc} — ${issue.description}`);
            }
        }
    }

    return lines.join('\n');
}

export default { auditSkill, formatAuditResult };
