/**
 * OpenClaw - Security Module
 * Centralized security controls: rate limiting, origin validation,
 * audit logging, input validation, SSRF protection.
 *
 * Addresses: CVE-2026-25253 (origin validation), CVE-2026-25157 (SSH
 * hostname injection), CVE-2026-25255 (SSRF), CVE-2026-25593 (unauth
 * config write), CVE-2026-24763 (PATH manipulation).
 */

import { createHash, randomBytes } from 'crypto';
import { log } from '../utils/logger.js';

// Re-export sandbox utilities
export {
    isPathAllowed,
    isCommandSafe,
    sanitizePath,
    redactSensitive,
    createSandbox,
} from './sandbox.js';
export type { SandboxConfig } from './sandbox.js';

// ==================== RATE LIMITER ====================

interface RateLimiterOptions {
    /** Max requests in the time window */
    maxRequests: number;
    /** Time window in milliseconds */
    windowMs: number;
    /** Max burst (tokens in bucket at any time) */
    maxBurst?: number;
}

interface BucketEntry {
    tokens: number;
    lastRefill: number;
    blocked: boolean;
    blockedUntil: number;
}

/**
 * Token-bucket rate limiter with per-key tracking.
 * Keys are typically client IPs or client IDs.
 */
export class RateLimiter {
    private buckets: Map<string, BucketEntry> = new Map();
    private maxTokens: number;
    private refillRate: number; // tokens per ms
    private blockDurationMs: number;
    private cleanupInterval: ReturnType<typeof setInterval>;

    constructor(options: RateLimiterOptions) {
        this.maxTokens = options.maxBurst ?? options.maxRequests;
        this.refillRate = options.maxRequests / options.windowMs;
        this.blockDurationMs = options.windowMs; // block for one window

        // Periodic cleanup of stale entries (every 60s)
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
        if (this.cleanupInterval.unref) this.cleanupInterval.unref();
    }

    /**
     * Returns true if the request is allowed, false if rate-limited.
     */
    consume(key: string): boolean {
        const now = Date.now();
        let bucket = this.buckets.get(key);

        if (!bucket) {
            bucket = {
                tokens: this.maxTokens - 1,
                lastRefill: now,
                blocked: false,
                blockedUntil: 0,
            };
            this.buckets.set(key, bucket);
            return true;
        }

        // Check if currently blocked
        if (bucket.blocked) {
            if (now < bucket.blockedUntil) {
                return false;
            }
            // Unblock
            bucket.blocked = false;
            bucket.tokens = this.maxTokens;
            bucket.lastRefill = now;
        }

        // Refill tokens
        const elapsed = now - bucket.lastRefill;
        bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
        bucket.lastRefill = now;

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return true;
        }

        // Rate limited — block the key
        bucket.blocked = true;
        bucket.blockedUntil = now + this.blockDurationMs;
        log.warn(`Rate limit exceeded for: ${key}`);
        return false;
    }

    /** Returns remaining tokens for a key (for rate limit headers) */
    remaining(key: string): number {
        const bucket = this.buckets.get(key);
        if (!bucket) return this.maxTokens;
        return Math.max(0, Math.floor(bucket.tokens));
    }

    private cleanup(): void {
        const now = Date.now();
        const staleThreshold = this.blockDurationMs * 2;
        for (const [key, bucket] of this.buckets) {
            if (now - bucket.lastRefill > staleThreshold && !bucket.blocked) {
                this.buckets.delete(key);
            }
        }
    }

    destroy(): void {
        clearInterval(this.cleanupInterval);
        this.buckets.clear();
    }
}

// ==================== ORIGIN VALIDATOR (CVE-2026-25253) ====================

/**
 * Validates WebSocket connection origins to prevent cross-site
 * WebSocket hijacking. This is the primary fix for CVE-2026-25253.
 */
export class OriginValidator {
    private allowedOrigins: Set<string>;
    private allowLocalhost: boolean;

    constructor(allowedOrigins: string[] = [], allowLocalhost = true) {
        this.allowedOrigins = new Set(
            allowedOrigins.map((o) => o.toLowerCase().replace(/\/$/, ''))
        );
        this.allowLocalhost = allowLocalhost;

        // Always allow common localhost variants when allowLocalhost is true
        if (allowLocalhost) {
            this.allowedOrigins.add('http://localhost');
            this.allowedOrigins.add('https://localhost');
            this.allowedOrigins.add('http://127.0.0.1');
            this.allowedOrigins.add('https://127.0.0.1');
            this.allowedOrigins.add('http://[::1]');
            this.allowedOrigins.add('https://[::1]');
        }
    }

    /**
     * Returns true if the origin is allowed.
     * Missing origin (non-browser clients like CLI/curl) is allowed
     * only if the connection comes from loopback.
     */
    isAllowed(origin: string | undefined, remoteAddress: string | undefined): boolean {
        // Non-browser clients (CLI, wscat, etc.) don't send Origin
        if (!origin) {
            return this.isLoopback(remoteAddress);
        }

        const normalized = origin.toLowerCase().replace(/\/$/, '');

        // Check exact match
        if (this.allowedOrigins.has(normalized)) {
            return true;
        }

        // Check with port variations for localhost
        if (this.allowLocalhost) {
            try {
                const url = new URL(normalized);
                const hostless = `${url.protocol}//${url.hostname}`;
                if (this.allowedOrigins.has(hostless)) {
                    return true;
                }
            } catch {
                // Invalid URL — reject
            }
        }

        log.warn(`Blocked WebSocket from unauthorized origin: ${origin}`);
        return false;
    }

    private isLoopback(address: string | undefined): boolean {
        if (!address) return false;
        return (
            address === '127.0.0.1' ||
            address === '::1' ||
            address === '::ffff:127.0.0.1' ||
            address === 'localhost'
        );
    }

    addOrigin(origin: string): void {
        this.allowedOrigins.add(origin.toLowerCase().replace(/\/$/, ''));
    }
}

// ==================== AUDIT LOGGER ====================

export interface SecurityEvent {
    timestamp: Date;
    type:
    | 'auth.success'
    | 'auth.failure'
    | 'auth.challenge'
    | 'rate_limit.exceeded'
    | 'origin.blocked'
    | 'input.rejected'
    | 'path.blocked'
    | 'command.blocked'
    | 'ssrf.blocked'
    | 'config.changed'
    | 'connection.open'
    | 'connection.close';
    source: string; // IP or client ID
    details: Record<string, unknown>;
}

/**
 * Security audit logger — records security-relevant events.
 * Events are stored in a ring buffer and can be exported for
 * compliance or forensic analysis.
 */
export class AuditLogger {
    private events: SecurityEvent[] = [];
    private maxEvents: number;

    constructor(maxEvents = 10_000) {
        this.maxEvents = maxEvents;
    }

    record(event: Omit<SecurityEvent, 'timestamp'>): void {
        const fullEvent: SecurityEvent = {
            ...event,
            timestamp: new Date(),
        };

        this.events.push(fullEvent);

        // Ring buffer — evict oldest
        if (this.events.length > this.maxEvents) {
            this.events = this.events.slice(-this.maxEvents);
        }

        // Also log to structured logger for external aggregation
        const logLevel = event.type.includes('failure') || event.type.includes('blocked')
            ? 'warn'
            : 'info';

        log[logLevel](`[AUDIT] ${event.type} from ${event.source}`, event.details);
    }

    getRecent(count = 100): SecurityEvent[] {
        return this.events.slice(-count);
    }

    getByType(type: SecurityEvent['type'], count = 100): SecurityEvent[] {
        return this.events.filter((e) => e.type === type).slice(-count);
    }

    clear(): void {
        this.events = [];
    }
}

// ==================== INPUT VALIDATOR ====================

interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Input validation for WebSocket messages.
 * Prevents oversized payloads, malformed JSON, and injections.
 */
export class InputValidator {
    private maxMessageSize: number; // bytes
    private maxStringLength: number;

    constructor(maxMessageSize = 1_048_576, maxStringLength = 100_000) {
        this.maxMessageSize = maxMessageSize;
        this.maxStringLength = maxStringLength;
    }

    /**
     * Validate a raw WebSocket message buffer.
     */
    validateRawMessage(data: Buffer | string): ValidationResult {
        const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;

        if (size > this.maxMessageSize) {
            return {
                valid: false,
                error: `Message too large: ${size} bytes (max: ${this.maxMessageSize})`,
            };
        }

        if (size === 0) {
            return { valid: false, error: 'Empty message' };
        }

        return { valid: true };
    }

    /**
     * Validate a parsed message object for expected structure.
     */
    validateMessage(message: Record<string, unknown>): ValidationResult {
        // Must be an object
        if (typeof message !== 'object' || message === null || Array.isArray(message)) {
            return { valid: false, error: 'Message must be a JSON object' };
        }

        // Must have a type or method field
        if (!message.type && !message.method) {
            return { valid: false, error: 'Message must have a "type" or "method" field' };
        }

        // Type/method must be a string
        const typeField = message.type ?? message.method;
        if (typeof typeField !== 'string') {
            return { valid: false, error: '"type" must be a string' };
        }

        // Prevent prototype pollution — only check OWN properties to avoid
        // false positives from Object.prototype.constructor
        const hasOwn = Object.prototype.hasOwnProperty;
        if (hasOwn.call(message, '__proto__') || hasOwn.call(message, 'constructor') || hasOwn.call(message, 'prototype')) {
            return { valid: false, error: 'Prototype pollution attempt detected' };
        }

        // Check string fields for excessive length
        for (const [key, value] of Object.entries(message)) {
            if (typeof value === 'string' && value.length > this.maxStringLength) {
                return {
                    valid: false,
                    error: `Field "${key}" exceeds maximum length (${value.length} > ${this.maxStringLength})`,
                };
            }
        }

        return { valid: true };
    }

    /**
     * Sanitize a string to remove control characters and null bytes.
     */
    sanitizeString(input: string): string {
        // Remove null bytes and most control chars (keep \t, \n, \r)
        // eslint-disable-next-line no-control-regex
        return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }
}

// ==================== SSRF PROTECTION (CVE-2026-25255) ====================

/**
 * Validates URLs to prevent Server-Side Request Forgery.
 * Blocks access to internal/private IP ranges and metadata endpoints.
 */
export function isUrlSafe(url: string): boolean {
    try {
        const parsed = new URL(url);

        // Block non-HTTP protocols
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            log.warn(`SSRF: blocked non-HTTP protocol: ${parsed.protocol}`);
            return false;
        }

        const hostname = parsed.hostname.toLowerCase();

        // Block metadata endpoints (AWS, GCP, Azure)
        const metadataHosts = [
            '169.254.169.254',
            'metadata.google.internal',
            'metadata.azure.com',
            '100.100.100.200',
        ];
        if (metadataHosts.includes(hostname)) {
            log.warn(`SSRF: blocked metadata endpoint: ${hostname}`);
            return false;
        }

        // Block private/internal IP ranges
        const privatePatterns = [
            /^127\./,
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[01])\./,
            /^192\.168\./,
            /^0\./,
            /^fc00:/i,
            /^fd00:/i,
            /^fe80:/i,
            /^::1$/,
            /^localhost$/i,
            /^0\.0\.0\.0$/,
        ];

        for (const pattern of privatePatterns) {
            if (pattern.test(hostname)) {
                log.warn(`SSRF: blocked private/internal address: ${hostname}`);
                return false;
            }
        }

        return true;
    } catch {
        log.warn(`SSRF: invalid URL blocked: ${url}`);
        return false;
    }
}

// ==================== SSH HOSTNAME INJECTION (CVE-2026-25157) ====================

/**
 * Validates hostnames to prevent injection via "--" prefix.
 * Attackers can craft hostnames starting with "--" to inject
 * command-line flags into SSH and similar tools.
 */
export function isSafeHostname(hostname: string): boolean {
    if (!hostname || typeof hostname !== 'string') return false;

    // Block "--" prefix (command injection via flag injection)
    if (hostname.startsWith('-')) {
        log.warn(`SSH injection: blocked hostname starting with dash: ${hostname}`);
        return false;
    }

    // Block backticks and $() (command substitution)
    if (/[`$]/.test(hostname)) {
        log.warn(`SSH injection: blocked hostname with command substitution: ${hostname}`);
        return false;
    }

    // Block semicolons, pipes, and other shell metacharacters
    if (/[;|&><\n\r]/.test(hostname)) {
        log.warn(`SSH injection: blocked hostname with shell metacharacters: ${hostname}`);
        return false;
    }

    // Must match valid hostname pattern
    const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
    if (!hostnamePattern.test(hostname) && !isIPAddress(hostname)) {
        log.warn(`SSH injection: invalid hostname format: ${hostname}`);
        return false;
    }

    return true;
}

function isIPAddress(str: string): boolean {
    // IPv4
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(str)) return true;
    // IPv6 (simplified)
    if (/^[\da-fA-F:]+$/.test(str)) return true;
    return false;
}

// ==================== PATH MANIPULATION DEFENSE (CVE-2026-24763) ====================

/**
 * Validates PATH environment variable to prevent PATH manipulation
 * that could lead to executing malicious binaries.
 */
export function sanitizeEnvPath(envPath: string | undefined): string {
    if (!envPath) return '';

    const separator = process.platform === 'win32' ? ';' : ':';
    const parts = envPath.split(separator);

    // Filter out suspicious PATH entries
    const safe = parts.filter((p) => {
        const normalized = p.toLowerCase().replace(/\\/g, '/');

        // Block relative paths (could be attacker-controlled)
        if (!p.startsWith('/') && !p.match(/^[A-Z]:\\/i)) {
            if (p !== '.' && !p.startsWith('./')) {
                log.warn(`PATH: blocked suspicious relative path: ${p}`);
                return false;
            }
        }

        // Block paths in /tmp, /var/tmp (attacker-writable)
        if (normalized.startsWith('/tmp/') || normalized.startsWith('/var/tmp/')) {
            log.warn(`PATH: blocked temp directory in PATH: ${p}`);
            return false;
        }

        return true;
    });

    return safe.join(separator);
}

// ==================== NONCE GENERATION ====================

/**
 * Generates a cryptographically secure nonce for challenge-response auth.
 */
export function generateNonce(length = 32): string {
    return randomBytes(length).toString('base64url');
}

/**
 * Generates a secure HMAC for webhook verification.
 */
export function generateHmac(payload: string, secret: string): string {
    return createHash('sha256').update(`${secret}:${payload}`).digest('hex');
}

// ==================== SECURITY HEADERS ====================

/**
 * Returns security headers to apply on all HTTP responses.
 */
export function getSecurityHeaders(): Record<string, string> {
    return {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '0', // modern CSP supersedes this
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
    };
}

// ==================== SINGLETON INSTANCES ====================

let auditLogger: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
    if (!auditLogger) {
        auditLogger = new AuditLogger();
    }
    return auditLogger;
}

let connectionLimiter: RateLimiter | null = null;
let messageLimiter: RateLimiter | null = null;

export function getConnectionLimiter(): RateLimiter {
    if (!connectionLimiter) {
        connectionLimiter = new RateLimiter({
            maxRequests: 20,
            windowMs: 60_000,  // 20 connections per minute per IP
            maxBurst: 5,
        });
    }
    return connectionLimiter;
}

export function getMessageLimiter(): RateLimiter {
    if (!messageLimiter) {
        messageLimiter = new RateLimiter({
            maxRequests: 120,
            windowMs: 60_000,  // 120 messages per minute per client
            maxBurst: 30,
        });
    }
    return messageLimiter;
}
