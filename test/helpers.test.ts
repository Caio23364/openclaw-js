/**
 * Tests for utils/helpers.ts
 * Covers: generateId, generateShortId, generatePairingCode, hashString,
 *         sleep, debounce, throttle, formatBytes, formatDuration,
 *         truncate, sanitizeFilename, parseMentions, extractUrls,
 *         isValidEmail, isValidPhone, maskString, deepClone,
 *         mergeObjects, pick, omit, StateStore
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    generateId,
    generateShortId,
    generatePairingCode,
    hashString,
    sleep,
    debounce,
    throttle,
    formatBytes,
    formatDuration,
    truncate,
    sanitizeFilename,
    parseMentions,
    extractUrls,
    isValidEmail,
    isValidPhone,
    maskString,
    deepClone,
    mergeObjects,
    pick,
    omit,
} from '../src/utils/helpers.js';

// ── generateId ────────────────────────────────────────────────────────
describe('generateId', () => {
    it('returns a valid UUID v4', () => {
        const id = generateId();
        expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
    });

    it('generates unique IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateId()));
        expect(ids.size).toBe(100);
    });
});

// ── generateShortId ───────────────────────────────────────────────────
describe('generateShortId', () => {
    it('returns default length of 8', () => {
        expect(generateShortId()).toHaveLength(8);
    });

    it('respects custom length', () => {
        expect(generateShortId(16)).toHaveLength(16);
        expect(generateShortId(4)).toHaveLength(4);
    });

    it('only contains alphanumeric characters', () => {
        const id = generateShortId(100);
        expect(id).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('generates unique values', () => {
        const ids = new Set(Array.from({ length: 50 }, () => generateShortId()));
        expect(ids.size).toBe(50);
    });
});

// ── generatePairingCode ───────────────────────────────────────────────
describe('generatePairingCode', () => {
    it('returns length of 6', () => {
        expect(generatePairingCode()).toHaveLength(6);
    });

    it('excludes ambiguous characters (O, 0, I, 1)', () => {
        // Run many times to increase confidence
        for (let i = 0; i < 100; i++) {
            const code = generatePairingCode();
            expect(code).not.toMatch(/[O01I]/);
        }
    });

    it('only contains uppercase letters and digits', () => {
        const code = generatePairingCode();
        expect(code).toMatch(/^[A-Z2-9]+$/);
    });
});

// ── hashString ────────────────────────────────────────────────────────
describe('hashString', () => {
    it('returns a 64-char hex string (SHA-256)', () => {
        const hash = hashString('test');
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
        expect(hashString('hello')).toBe(hashString('hello'));
    });

    it('differs for different inputs', () => {
        expect(hashString('a')).not.toBe(hashString('b'));
    });
});

// ── sleep ─────────────────────────────────────────────────────────────
describe('sleep', () => {
    it('resolves after the given ms', async () => {
        const start = Date.now();
        await sleep(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(40); // allow timer jitter
    });
});

// ── debounce ──────────────────────────────────────────────────────────
describe('debounce', () => {
    beforeEach(() => void vi.useFakeTimers());
    afterEach(() => void vi.useRealTimers());

    it('only calls fn after delay elapses', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        debounced();
        debounced();
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('resets delay on rapid calls', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        vi.advanceTimersByTime(80);
        debounced(); // reset
        vi.advanceTimersByTime(80);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(20);
        expect(fn).toHaveBeenCalledOnce();
    });
});

// ── throttle ──────────────────────────────────────────────────────────
describe('throttle', () => {
    beforeEach(() => void vi.useFakeTimers());
    afterEach(() => void vi.useRealTimers());

    it('calls fn immediately on first call', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 100);

        throttled();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('ignores calls within the throttle window', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 100);

        throttled();
        throttled();
        throttled();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('allows a new call after the window expires', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 100);

        throttled();
        vi.advanceTimersByTime(100);
        throttled();
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

// ── formatBytes ───────────────────────────────────────────────────────
describe('formatBytes', () => {
    it('handles 0', () => expect(formatBytes(0)).toBe('0 Bytes'));
    it('formats bytes', () => expect(formatBytes(500)).toBe('500 Bytes'));
    it('formats KB', () => expect(formatBytes(1024)).toBe('1 KB'));
    it('formats MB', () => expect(formatBytes(1048576)).toBe('1 MB'));
    it('formats GB', () => expect(formatBytes(1073741824)).toBe('1 GB'));
    it('respects decimal places', () => {
        expect(formatBytes(1536, 1)).toBe('1.5 KB');
    });
});

// ── formatDuration ────────────────────────────────────────────────────
describe('formatDuration', () => {
    it('formats milliseconds', () => expect(formatDuration(250)).toBe('250ms'));
    it('formats seconds', () => expect(formatDuration(2500)).toBe('2.5s'));
    it('formats minutes', () => expect(formatDuration(90000)).toBe('1.5m'));
    it('formats hours', () => expect(formatDuration(5400000)).toBe('1.5h'));
});

// ── truncate ──────────────────────────────────────────────────────────
describe('truncate', () => {
    it('returns short strings unchanged', () => {
        expect(truncate('hi', 10)).toBe('hi');
    });

    it('truncates long strings with ellipsis', () => {
        expect(truncate('hello world', 8)).toBe('hello...');
    });

    it('handles exact boundary', () => {
        expect(truncate('hello', 5)).toBe('hello');
    });
});

// ── sanitizeFilename ──────────────────────────────────────────────────
describe('sanitizeFilename', () => {
    it('replaces special chars with _', () => {
        expect(sanitizeFilename('my file (1).txt')).toBe('my_file__1_.txt');
    });

    it('keeps safe characters', () => {
        expect(sanitizeFilename('report-2024.01.pdf')).toBe('report-2024.01.pdf');
    });
});

// ── parseMentions ─────────────────────────────────────────────────────
describe('parseMentions', () => {
    it('extracts @mentions from text', () => {
        expect(parseMentions('hello @alice and @bob')).toEqual(['alice', 'bob']);
    });

    it('returns empty array when no mentions', () => {
        expect(parseMentions('no mentions here')).toEqual([]);
    });
});

// ── extractUrls ───────────────────────────────────────────────────────
describe('extractUrls', () => {
    it('extracts URLs from text', () => {
        const urls = extractUrls('Visit https://example.com or http://test.io');
        expect(urls).toEqual(['https://example.com', 'http://test.io']);
    });

    it('returns empty array when no URLs', () => {
        expect(extractUrls('no urls here')).toEqual([]);
    });
});

// ── isValidEmail ──────────────────────────────────────────────────────
describe('isValidEmail', () => {
    it('accepts valid emails', () => {
        expect(isValidEmail('user@example.com')).toBe(true);
        expect(isValidEmail('test.name@domain.co')).toBe(true);
    });

    it('rejects invalid emails', () => {
        expect(isValidEmail('notanemail')).toBe(false);
        expect(isValidEmail('@no-user.com')).toBe(false);
        expect(isValidEmail('user@')).toBe(false);
    });
});

// ── isValidPhone ──────────────────────────────────────────────────────
describe('isValidPhone', () => {
    it('accepts valid phone numbers', () => {
        expect(isValidPhone('+5511999999999')).toBe(true);
        expect(isValidPhone('5511999999999')).toBe(true);
    });

    it('rejects invalid phones', () => {
        expect(isValidPhone('abc')).toBe(false);
        expect(isValidPhone('')).toBe(false);
        expect(isValidPhone('+0123')).toBe(false); // starts with 0
    });
});

// ── maskString ────────────────────────────────────────────────────────
describe('maskString', () => {
    it('masks the middle of long strings', () => {
        expect(maskString('sk-abcdefghij1234567890')).toBe('sk-a***7890');
    });

    it('fully masks short strings', () => {
        expect(maskString('ab', 4)).toBe('**');
    });
});

// ── deepClone ─────────────────────────────────────────────────────────
describe('deepClone', () => {
    it('creates a separate copy', () => {
        const obj = { a: 1, b: { c: 2 } };
        const cloned = deepClone(obj);
        cloned.b.c = 99;
        expect(obj.b.c).toBe(2); // original unchanged
    });

    it('handles arrays', () => {
        const arr = [1, [2, 3]];
        const cloned = deepClone(arr);
        (cloned[1] as number[]).push(4);
        expect(arr[1]).toEqual([2, 3]);
    });

    it('handles Dates', () => {
        const d = new Date('2024-01-01');
        const cloned = deepClone(d);
        expect(cloned.getTime()).toBe(d.getTime());
        expect(cloned).not.toBe(d); // different reference
    });
});

// ── mergeObjects ──────────────────────────────────────────────────────
describe('mergeObjects', () => {
    it('merges source into target', () => {
        expect(mergeObjects({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
    });

    it('does not mutate the original', () => {
        const target = { a: 1 };
        mergeObjects(target, { a: 2 });
        expect(target.a).toBe(1);
    });
});

// ── pick ──────────────────────────────────────────────────────────────
describe('pick', () => {
    it('picks specified keys', () => {
        expect(pick({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });

    it('ignores missing keys', () => {
        expect(pick({ a: 1 }, ['a', 'b' as any])).toEqual({ a: 1 });
    });
});

// ── omit ──────────────────────────────────────────────────────────────
describe('omit', () => {
    it('omits specified keys', () => {
        expect(omit({ a: 1, b: 2, c: 3 }, ['b'])).toEqual({ a: 1, c: 3 });
    });

    it('does not mutate the original', () => {
        const obj = { a: 1, b: 2 };
        omit(obj, ['b']);
        expect(obj).toHaveProperty('b');
    });
});
