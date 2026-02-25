/**
 * OpenClaw - Metrics System
 * Comprehensive usage tracking, estimation, and analytics
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { log } from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';

// ==================== TYPES ====================

export interface MetricsSnapshot {
    timestamp: Date;
    uptime: number; // ms since start
    system: SystemMetrics;
    messages: MessageMetrics;
    tokens: TokenMetrics;
    costs: CostMetrics;
    sessions: SessionMetrics;
    channels: ChannelMetrics;
    providers: ProviderMetrics;
    gateway: GatewayMetrics;
    tools: ToolMetrics;
    estimation: UsageEstimation;
    resources: ResourceEstimation;
}

export interface SystemMetrics {
    memoryUsage: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers: number;
    };
    cpuUsage: {
        user: number;
        system: number;
    };
    uptime: number;
    nodeVersion: string;
    platform: string;
    arch: string;
}

export interface MessageMetrics {
    total: number;
    received: number;
    sent: number;
    failed: number;
    avgPerHour: number;
    avgPerDay: number;
    peakPerHour: number;
    peakHourTimestamp?: Date;
    byChannel: Record<string, number>;
    byType: Record<string, number>; // direct, group, channel
    hourlyBreakdown: HourlyBucket[];
    dailyBreakdown: DailyBucket[];
}

export interface TokenMetrics {
    totalInput: number;
    totalOutput: number;
    total: number;
    avgPerMessage: number;
    avgPerSession: number;
    byProvider: Record<string, { input: number; output: number; total: number }>;
    byModel: Record<string, { input: number; output: number; total: number }>;
    hourlyBreakdown: HourlyBucket[];
}

export interface CostMetrics {
    totalUSD: number;
    avgPerMessage: number;
    avgPerSession: number;
    avgPerDay: number;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
    dailyBreakdown: DailyBucket[];
    projectedMonthly: number;
}

export interface SessionMetrics {
    totalCreated: number;
    active: number;
    avgDuration: number; // ms
    avgMessagesPerSession: number;
    avgTokensPerSession: number;
    longestSession: number; // ms
    shortestSession: number; // ms
    byChannel: Record<string, number>;
}

export interface ChannelMetrics {
    active: number;
    totalMessages: Record<string, number>;
    activeUsers: Record<string, number>;
    uptime: Record<string, number>; // percentage
    errors: Record<string, number>;
    latency: Record<string, number>; // avg ms
}

export interface ProviderMetrics {
    requests: Record<string, number>;
    errors: Record<string, number>;
    avgLatency: Record<string, number>; // ms
    availability: Record<string, number>; // percentage
    tokensByProvider: Record<string, { input: number; output: number }>;
}

export interface GatewayMetrics {
    wsConnections: number;
    wsMessagesReceived: number;
    wsMessagesSent: number;
    httpRequests: number;
    httpErrors: number;
    socketioConnections: number;
    avgResponseTime: number;
    peakConnections: number;
    peakConnectionsTimestamp?: Date;
}

export interface ToolMetrics {
    totalCalls: number;
    successRate: number;
    avgExecutionTime: number;
    byTool: Record<string, { calls: number; success: number; avgTime: number }>;
}

export interface UsageEstimation {
    // Current rate
    messagesPerHour: number;
    messagesPerDay: number;
    messagesPerMonth: number;
    tokensPerHour: number;
    tokensPerDay: number;
    tokensPerMonth: number;
    costPerHour: number;
    costPerDay: number;
    costPerMonth: number;

    // Projections (next 30 days based on trend)
    projectedMessages30d: number;
    projectedTokens30d: number;
    projectedCost30d: number;

    // Capacity
    activeSessions: number;
    peakConcurrentSessions: number;
    avgSessionLifetime: number; // ms

    // Trends
    messagesTrend: 'increasing' | 'stable' | 'decreasing';
    tokensTrend: 'increasing' | 'stable' | 'decreasing';
    costTrend: 'increasing' | 'stable' | 'decreasing';
}

export interface ResourceSample {
    timestamp: string; // ISO
    cpuPercent: number;
    memoryPercent: number;
    memoryUsedMB: number;
    heapUsedMB: number;
    loadAvg1: number;
}

export interface ResourceEstimation {
    // Current
    cpuPercent: number;
    memoryPercent: number;
    memoryUsedMB: number;
    memoryTotalMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    heapPercent: number;
    loadAvg: [number, number, number]; // 1, 5, 15 min
    osTotalMemoryMB: number;
    osFreeMemoryMB: number;
    osUsedMemoryMB: number;
    osMemoryPercent: number;
    cpuCount: number;
    cpuModel: string;

    // Averages
    avgCpuPercent: number;
    avgMemoryPercent: number;
    avgHeapPercent: number;

    // Peaks
    peakCpuPercent: number;
    peakCpuTimestamp?: string;
    peakMemoryMB: number;
    peakMemoryTimestamp?: string;
    peakHeapMB: number;
    peakHeapTimestamp?: string;

    // Trends
    cpuTrend: 'increasing' | 'stable' | 'decreasing';
    memoryTrend: 'increasing' | 'stable' | 'decreasing';
    heapTrend: 'increasing' | 'stable' | 'decreasing';

    // Projections
    memoryGrowthMBPerHour: number;
    estimatedOOMHours: number | null; // null = stable/decreasing

    // Sparkline data (last 60 samples)
    cpuHistory: number[];
    memoryHistory: number[];
    heapHistory: number[];
}

export interface HourlyBucket {
    hour: string; // ISO timestamp truncated to hour
    count: number;
    tokens?: number;
    cost?: number;
}

export interface DailyBucket {
    date: string; // YYYY-MM-DD
    count: number;
    tokens?: number;
    cost?: number;
}

interface MetricEvent {
    type: 'message_received' | 'message_sent' | 'message_failed'
    | 'token_usage' | 'provider_request' | 'provider_error'
    | 'session_created' | 'session_ended'
    | 'tool_call' | 'tool_success' | 'tool_error'
    | 'ws_connect' | 'ws_disconnect' | 'ws_message'
    | 'http_request' | 'http_error';
    timestamp: Date;
    data: Record<string, any>;
}

// ==================== BUFFER LIMITS (picoclaw-inspired) ====================

const BUFFER_LIMITS = {
    /** Maximum events kept in memory */
    MAX_EVENTS: 2000,
    /** Evict down to this many events when limit is hit */
    EVENTS_EVICT_TO: 1000,
    /** Maximum latency samples per provider/channel */
    MAX_LATENCY_SAMPLES: 100,
    /** Maximum gateway response time samples */
    MAX_GATEWAY_SAMPLES: 200,
    /** Maximum session duration samples */
    MAX_SESSION_DURATIONS: 500,
    /** Maximum resource samples (~1 hour at 10s intervals) */
    MAX_RESOURCE_SAMPLES: 360,
    /** Maximum days to keep in hourly/daily maps */
    MAX_HISTORY_DAYS: 7,
    /** Cleanup interval in milliseconds (5 minutes) */
    CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
    /** Maximum entries in activeUsersByChannel per channel */
    MAX_ACTIVE_USERS_PER_CHANNEL: 1000,
};

// ==================== METRICS COLLECTOR ====================

export class MetricsCollector {
    private events: MetricEvent[] = [];
    private startTime: Date;
    private dataDir: string;

    // Running counters
    private counters = {
        messagesReceived: 0,
        messagesSent: 0,
        messagesFailed: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        totalCostUSD: 0,
        sessionsCreated: 0,
        sessionsEnded: 0,
        toolCalls: 0,
        toolSuccess: 0,
        toolErrors: 0,
        wsConnections: 0,
        wsDisconnections: 0,
        wsMessagesReceived: 0,
        wsMessagesSent: 0,
        httpRequests: 0,
        httpErrors: 0,
        providerRequests: 0,
        providerErrors: 0,
    };

    // By-channel counters
    private messagesByChannel: Record<string, number> = {};
    private messagesByType: Record<string, number> = {};
    private tokensByProvider: Record<string, { input: number; output: number }> = {};
    private tokensByModel: Record<string, { input: number; output: number }> = {};
    private costByProvider: Record<string, number> = {};
    private costByModel: Record<string, number> = {};
    private providerRequests: Record<string, number> = {};
    private providerErrors: Record<string, number> = {};
    private sessionsByChannel: Record<string, number> = {};
    private channelErrors: Record<string, number> = {};
    private activeUsersByChannel: Record<string, Set<string>> = {};
    private toolStats: Record<string, { calls: number; success: number; totalTime: number }> = {};

    // Latency tracking
    private providerLatencies: Record<string, number[]> = {};
    private channelLatencies: Record<string, number[]> = {};
    private gatewayResponseTimes: number[] = [];

    // Peak tracking
    private peakConnectionCount = 0;
    private peakConnectionTimestamp?: Date;
    private peakMessagesPerHour = 0;
    private peakHourTimestamp?: Date;
    private currentHourMessages = 0;
    private currentHourStart: Date;

    // Session tracking
    private activeSessions = new Map<string, { startTime: Date; channel: string }>();
    private sessionDurations: number[] = [];
    private sessionMessageCounts: Map<string, number> = new Map();
    private sessionTokenCounts: Map<string, number> = new Map();
    private peakConcurrentSessions = 0;

    // Hourly/Daily buckets
    private hourlyMessages: Map<string, number> = new Map();
    private hourlyTokens: Map<string, number> = new Map();
    private dailyMessages: Map<string, number> = new Map();
    private dailyTokens: Map<string, number> = new Map();
    private dailyCosts: Map<string, number> = new Map();

    // Auto-persist timer
    private persistTimer?: ReturnType<typeof setInterval>;

    // Cleanup timer (picoclaw-inspired bounded buffers)
    private cleanupTimer?: ReturnType<typeof setInterval>;

    // System resource sampling
    private resourceSamples: ResourceSample[] = [];
    private resourceSampleTimer?: ReturnType<typeof setInterval>;
    private prevCpuUsage = process.cpuUsage();
    private prevCpuTime = Date.now();
    private peakCpuPercent = 0;
    private peakCpuTimestamp?: string;
    private peakMemoryMB = 0;
    private peakMemoryTimestamp?: string;
    private peakHeapMB = 0;
    private peakHeapTimestamp?: string;

    constructor(dataDir?: string) {
        this.startTime = new Date();
        this.currentHourStart = new Date();
        this.dataDir = dataDir || join(process.cwd(), 'data', 'metrics');
        this.startResourceSampling();
        this.startPeriodicCleanup();
    }

    /**
     * Periodic cleanup of unbounded buffers (picoclaw-inspired).
     * Prevents memory leaks from hourly/daily maps, latency arrays,
     * activeUsers sets, and session tracking.
     */
    private startPeriodicCleanup(): void {
        this.cleanupTimer = setInterval(() => this.cleanupBuffers(), BUFFER_LIMITS.CLEANUP_INTERVAL_MS);
    }

    private cleanupBuffers(): void {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - BUFFER_LIMITS.MAX_HISTORY_DAYS);
        const cutoffDay = cutoffDate.toISOString().split('T')[0];
        const cutoffHour = cutoffDay + 'T00:00';

        // Prune hourly maps older than MAX_HISTORY_DAYS
        for (const [key] of this.hourlyMessages) {
            if (key < cutoffHour) this.hourlyMessages.delete(key);
        }
        for (const [key] of this.hourlyTokens) {
            if (key < cutoffHour) this.hourlyTokens.delete(key);
        }

        // Prune daily maps older than MAX_HISTORY_DAYS
        for (const [key] of this.dailyMessages) {
            if (key < cutoffDay) this.dailyMessages.delete(key);
        }
        for (const [key] of this.dailyTokens) {
            if (key < cutoffDay) this.dailyTokens.delete(key);
        }
        for (const [key] of this.dailyCosts) {
            if (key < cutoffDay) this.dailyCosts.delete(key);
        }

        // Cap latency arrays
        for (const key of Object.keys(this.providerLatencies)) {
            if (this.providerLatencies[key].length > BUFFER_LIMITS.MAX_LATENCY_SAMPLES) {
                this.providerLatencies[key] = this.providerLatencies[key].slice(-BUFFER_LIMITS.MAX_LATENCY_SAMPLES);
            }
        }
        for (const key of Object.keys(this.channelLatencies)) {
            if (this.channelLatencies[key].length > BUFFER_LIMITS.MAX_LATENCY_SAMPLES) {
                this.channelLatencies[key] = this.channelLatencies[key].slice(-BUFFER_LIMITS.MAX_LATENCY_SAMPLES);
            }
        }
        if (this.gatewayResponseTimes.length > BUFFER_LIMITS.MAX_GATEWAY_SAMPLES) {
            this.gatewayResponseTimes = this.gatewayResponseTimes.slice(-BUFFER_LIMITS.MAX_GATEWAY_SAMPLES);
        }

        // Cap session durations
        if (this.sessionDurations.length > BUFFER_LIMITS.MAX_SESSION_DURATIONS) {
            this.sessionDurations = this.sessionDurations.slice(-BUFFER_LIMITS.MAX_SESSION_DURATIONS);
        }

        // Prune ended sessions from tracking maps
        for (const [sessionId] of this.sessionMessageCounts) {
            if (!this.activeSessions.has(sessionId)) {
                this.sessionMessageCounts.delete(sessionId);
            }
        }
        for (const [sessionId] of this.sessionTokenCounts) {
            if (!this.activeSessions.has(sessionId)) {
                this.sessionTokenCounts.delete(sessionId);
            }
        }

        // Cap activeUsers per channel
        for (const channel of Object.keys(this.activeUsersByChannel)) {
            if (this.activeUsersByChannel[channel].size > BUFFER_LIMITS.MAX_ACTIVE_USERS_PER_CHANNEL) {
                const users = Array.from(this.activeUsersByChannel[channel]);
                this.activeUsersByChannel[channel] = new Set(users.slice(-BUFFER_LIMITS.MAX_ACTIVE_USERS_PER_CHANNEL));
            }
        }
    }

    private startResourceSampling(): void {
        // Sample every 10 seconds
        this.sampleResources(); // immediate first sample
        this.resourceSampleTimer = setInterval(() => this.sampleResources(), 10000);
    }

    private sampleResources(): void {
        const now = Date.now();
        const cpuNow = process.cpuUsage(this.prevCpuUsage);
        const elapsedMs = now - this.prevCpuTime;
        const cpuCores = os.cpus().length || 1;
        // CPU% = (user+system microseconds used) / (elapsed microseconds * cores) * 100
        const cpuPercent = elapsedMs > 0
            ? Math.min(100, ((cpuNow.user + cpuNow.system) / 1000) / elapsedMs / cpuCores * 100)
            : 0;
        this.prevCpuUsage = process.cpuUsage();
        this.prevCpuTime = now;

        const mem = process.memoryUsage();
        const osTotalMem = os.totalmem();
        const osFreeMem = os.freemem();
        const memoryUsedMB = mem.rss / (1024 * 1024);
        const heapUsedMB = mem.heapUsed / (1024 * 1024);
        const memoryPercent = osTotalMem > 0 ? ((osTotalMem - osFreeMem) / osTotalMem) * 100 : 0;
        const loadAvg = os.loadavg();

        const ts = new Date(now).toISOString();

        const sample: ResourceSample = {
            timestamp: ts,
            cpuPercent: Math.round(cpuPercent * 100) / 100,
            memoryPercent: Math.round(memoryPercent * 100) / 100,
            memoryUsedMB: Math.round(memoryUsedMB * 100) / 100,
            heapUsedMB: Math.round(heapUsedMB * 100) / 100,
            loadAvg1: Math.round(loadAvg[0] * 100) / 100,
        };

        this.resourceSamples.push(sample);
        // Keep last 360 samples (~1 hour at 10s intervals)
        if (this.resourceSamples.length > 360) {
            this.resourceSamples = this.resourceSamples.slice(-360);
        }

        // Peak tracking
        if (sample.cpuPercent > this.peakCpuPercent) {
            this.peakCpuPercent = sample.cpuPercent;
            this.peakCpuTimestamp = ts;
        }
        if (memoryUsedMB > this.peakMemoryMB) {
            this.peakMemoryMB = memoryUsedMB;
            this.peakMemoryTimestamp = ts;
        }
        if (heapUsedMB > this.peakHeapMB) {
            this.peakHeapMB = heapUsedMB;
            this.peakHeapTimestamp = ts;
        }
    }

    // ==================== EVENT RECORDING ====================

    public recordMessageReceived(channel: string, chatType: string, senderId: string): void {
        this.counters.messagesReceived++;
        this.messagesByChannel[channel] = (this.messagesByChannel[channel] || 0) + 1;
        this.messagesByType[chatType] = (this.messagesByType[chatType] || 0) + 1;

        // Track active users
        if (!this.activeUsersByChannel[channel]) {
            this.activeUsersByChannel[channel] = new Set();
        }
        this.activeUsersByChannel[channel].add(senderId);

        // Hourly/daily tracking
        const hourKey = this.getHourKey();
        const dayKey = this.getDayKey();
        this.hourlyMessages.set(hourKey, (this.hourlyMessages.get(hourKey) || 0) + 1);
        this.dailyMessages.set(dayKey, (this.dailyMessages.get(dayKey) || 0) + 1);

        // Peak tracking
        this.currentHourMessages++;
        this.checkHourlyPeak();

        this.pushEvent('message_received', { channel, chatType, senderId });
    }

    public recordMessageSent(channel: string): void {
        this.counters.messagesSent++;
        this.pushEvent('message_sent', { channel });
    }

    public recordMessageFailed(channel: string, error: string): void {
        this.counters.messagesFailed++;
        this.channelErrors[channel] = (this.channelErrors[channel] || 0) + 1;
        this.pushEvent('message_failed', { channel, error });
    }

    public recordTokenUsage(
        provider: string,
        model: string,
        inputTokens: number,
        outputTokens: number,
        costUSD: number,
        sessionId?: string
    ): void {
        this.counters.totalTokensInput += inputTokens;
        this.counters.totalTokensOutput += outputTokens;
        this.counters.totalCostUSD += costUSD;

        // By provider
        if (!this.tokensByProvider[provider]) {
            this.tokensByProvider[provider] = { input: 0, output: 0 };
        }
        this.tokensByProvider[provider].input += inputTokens;
        this.tokensByProvider[provider].output += outputTokens;

        // By model
        if (!this.tokensByModel[model]) {
            this.tokensByModel[model] = { input: 0, output: 0 };
        }
        this.tokensByModel[model].input += inputTokens;
        this.tokensByModel[model].output += outputTokens;

        // Costs
        this.costByProvider[provider] = (this.costByProvider[provider] || 0) + costUSD;
        this.costByModel[model] = (this.costByModel[model] || 0) + costUSD;

        // Hourly/daily
        const hourKey = this.getHourKey();
        const dayKey = this.getDayKey();
        this.hourlyTokens.set(hourKey, (this.hourlyTokens.get(hourKey) || 0) + inputTokens + outputTokens);
        this.dailyTokens.set(dayKey, (this.dailyTokens.get(dayKey) || 0) + inputTokens + outputTokens);
        this.dailyCosts.set(dayKey, (this.dailyCosts.get(dayKey) || 0) + costUSD);

        // Session-level
        if (sessionId) {
            this.sessionTokenCounts.set(
                sessionId,
                (this.sessionTokenCounts.get(sessionId) || 0) + inputTokens + outputTokens
            );
        }

        this.pushEvent('token_usage', { provider, model, inputTokens, outputTokens, costUSD });
    }

    public recordProviderRequest(provider: string, latencyMs: number): void {
        this.counters.providerRequests++;
        this.providerRequests[provider] = (this.providerRequests[provider] || 0) + 1;

        if (!this.providerLatencies[provider]) {
            this.providerLatencies[provider] = [];
        }
        this.providerLatencies[provider].push(latencyMs);

        // Keep only last 1000 latency samples per provider
        if (this.providerLatencies[provider].length > 1000) {
            this.providerLatencies[provider] = this.providerLatencies[provider].slice(-500);
        }

        this.pushEvent('provider_request', { provider, latencyMs });
    }

    public recordProviderError(provider: string, error: string): void {
        this.counters.providerErrors++;
        this.providerErrors[provider] = (this.providerErrors[provider] || 0) + 1;
        this.pushEvent('provider_error', { provider, error });
    }

    public recordSessionCreated(sessionId: string, channel: string): void {
        this.counters.sessionsCreated++;
        this.activeSessions.set(sessionId, { startTime: new Date(), channel });
        this.sessionsByChannel[channel] = (this.sessionsByChannel[channel] || 0) + 1;
        this.sessionMessageCounts.set(sessionId, 0);
        this.sessionTokenCounts.set(sessionId, 0);

        if (this.activeSessions.size > this.peakConcurrentSessions) {
            this.peakConcurrentSessions = this.activeSessions.size;
        }

        this.pushEvent('session_created', { sessionId, channel });
    }

    public recordSessionEnded(sessionId: string): void {
        this.counters.sessionsEnded++;
        const session = this.activeSessions.get(sessionId);
        if (session) {
            const duration = Date.now() - session.startTime.getTime();
            this.sessionDurations.push(duration);
            this.activeSessions.delete(sessionId);
        }
        this.pushEvent('session_ended', { sessionId });
    }

    public recordSessionMessage(sessionId: string): void {
        this.sessionMessageCounts.set(
            sessionId,
            (this.sessionMessageCounts.get(sessionId) || 0) + 1
        );
    }

    public recordToolCall(toolName: string, success: boolean, executionTimeMs: number): void {
        this.counters.toolCalls++;
        if (success) {
            this.counters.toolSuccess++;
        } else {
            this.counters.toolErrors++;
        }

        if (!this.toolStats[toolName]) {
            this.toolStats[toolName] = { calls: 0, success: 0, totalTime: 0 };
        }
        this.toolStats[toolName].calls++;
        if (success) this.toolStats[toolName].success++;
        this.toolStats[toolName].totalTime += executionTimeMs;

        this.pushEvent(success ? 'tool_success' : 'tool_error', { toolName, executionTimeMs });
    }

    public recordWsConnection(): void {
        this.counters.wsConnections++;
        const currentConnections = this.counters.wsConnections - this.counters.wsDisconnections;
        if (currentConnections > this.peakConnectionCount) {
            this.peakConnectionCount = currentConnections;
            this.peakConnectionTimestamp = new Date();
        }
        this.pushEvent('ws_connect', {});
    }

    public recordWsDisconnection(): void {
        this.counters.wsDisconnections++;
        this.pushEvent('ws_disconnect', {});
    }

    public recordWsMessage(direction: 'in' | 'out'): void {
        if (direction === 'in') {
            this.counters.wsMessagesReceived++;
        } else {
            this.counters.wsMessagesSent++;
        }
        this.pushEvent('ws_message', { direction });
    }

    public recordHttpRequest(responseTimeMs: number): void {
        this.counters.httpRequests++;
        this.gatewayResponseTimes.push(responseTimeMs);
        if (this.gatewayResponseTimes.length > 1000) {
            this.gatewayResponseTimes = this.gatewayResponseTimes.slice(-500);
        }
        this.pushEvent('http_request', { responseTimeMs });
    }

    public recordHttpError(): void {
        this.counters.httpErrors++;
        this.pushEvent('http_error', {});
    }

    // ==================== SNAPSHOT GENERATION ====================

    public getSnapshot(): MetricsSnapshot {
        const now = new Date();
        const uptimeMs = now.getTime() - this.startTime.getTime();
        const uptimeHours = uptimeMs / (1000 * 60 * 60);
        const uptimeDays = uptimeHours / 24;

        const totalMessages = this.counters.messagesReceived + this.counters.messagesSent;
        const totalTokens = this.counters.totalTokensInput + this.counters.totalTokensOutput;

        return {
            timestamp: now,
            uptime: uptimeMs,
            system: this.getSystemMetrics(),
            messages: this.getMessageMetrics(uptimeHours, uptimeDays),
            tokens: this.getTokenMetrics(totalMessages),
            costs: this.getCostMetrics(totalMessages, uptimeDays),
            sessions: this.getSessionMetrics(),
            channels: this.getChannelMetrics(),
            providers: this.getProviderMetrics(),
            gateway: this.getGatewayMetrics(),
            tools: this.getToolMetrics(),
            estimation: this.getUsageEstimation(uptimeHours, uptimeDays),
            resources: this.getResourceEstimation(),
        };
    }

    private getSystemMetrics(): SystemMetrics {
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage();
        return {
            memoryUsage: {
                rss: mem.rss,
                heapTotal: mem.heapTotal,
                heapUsed: mem.heapUsed,
                external: mem.external,
                arrayBuffers: mem.arrayBuffers,
            },
            cpuUsage: {
                user: cpu.user,
                system: cpu.system,
            },
            uptime: process.uptime(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
        };
    }

    private getMessageMetrics(uptimeHours: number, uptimeDays: number): MessageMetrics {
        const totalMessages = this.counters.messagesReceived + this.counters.messagesSent;
        return {
            total: totalMessages,
            received: this.counters.messagesReceived,
            sent: this.counters.messagesSent,
            failed: this.counters.messagesFailed,
            avgPerHour: uptimeHours > 0 ? totalMessages / uptimeHours : 0,
            avgPerDay: uptimeDays > 0 ? totalMessages / uptimeDays : 0,
            peakPerHour: this.peakMessagesPerHour,
            peakHourTimestamp: this.peakHourTimestamp,
            byChannel: { ...this.messagesByChannel },
            byType: { ...this.messagesByType },
            hourlyBreakdown: this.getHourlyBreakdown(this.hourlyMessages),
            dailyBreakdown: this.getDailyBreakdown(this.dailyMessages),
        };
    }

    private getTokenMetrics(totalMessages: number): TokenMetrics {
        const totalTokens = this.counters.totalTokensInput + this.counters.totalTokensOutput;
        const byProvider: Record<string, { input: number; output: number; total: number }> = {};
        for (const [p, t] of Object.entries(this.tokensByProvider)) {
            byProvider[p] = { input: t.input, output: t.output, total: t.input + t.output };
        }
        const byModel: Record<string, { input: number; output: number; total: number }> = {};
        for (const [m, t] of Object.entries(this.tokensByModel)) {
            byModel[m] = { input: t.input, output: t.output, total: t.input + t.output };
        }

        return {
            totalInput: this.counters.totalTokensInput,
            totalOutput: this.counters.totalTokensOutput,
            total: totalTokens,
            avgPerMessage: totalMessages > 0 ? totalTokens / totalMessages : 0,
            avgPerSession: this.counters.sessionsCreated > 0
                ? totalTokens / this.counters.sessionsCreated : 0,
            byProvider,
            byModel,
            hourlyBreakdown: this.getHourlyBreakdown(this.hourlyTokens),
        };
    }

    private getCostMetrics(totalMessages: number, uptimeDays: number): CostMetrics {
        const avgPerDay = uptimeDays > 0 ? this.counters.totalCostUSD / uptimeDays : 0;
        return {
            totalUSD: this.counters.totalCostUSD,
            avgPerMessage: totalMessages > 0 ? this.counters.totalCostUSD / totalMessages : 0,
            avgPerSession: this.counters.sessionsCreated > 0
                ? this.counters.totalCostUSD / this.counters.sessionsCreated : 0,
            avgPerDay,
            byProvider: { ...this.costByProvider },
            byModel: { ...this.costByModel },
            dailyBreakdown: this.getDailyBreakdownWithCost(),
            projectedMonthly: avgPerDay * 30,
        };
    }

    private getSessionMetrics(): SessionMetrics {
        const avgDuration = this.sessionDurations.length > 0
            ? this.sessionDurations.reduce((a, b) => a + b, 0) / this.sessionDurations.length : 0;
        const allMessageCounts = Array.from(this.sessionMessageCounts.values());
        const avgMessages = allMessageCounts.length > 0
            ? allMessageCounts.reduce((a, b) => a + b, 0) / allMessageCounts.length : 0;
        const allTokenCounts = Array.from(this.sessionTokenCounts.values());
        const avgTokens = allTokenCounts.length > 0
            ? allTokenCounts.reduce((a, b) => a + b, 0) / allTokenCounts.length : 0;

        return {
            totalCreated: this.counters.sessionsCreated,
            active: this.activeSessions.size,
            avgDuration,
            avgMessagesPerSession: avgMessages,
            avgTokensPerSession: avgTokens,
            longestSession: this.sessionDurations.length > 0 ? Math.max(...this.sessionDurations) : 0,
            shortestSession: this.sessionDurations.length > 0 ? Math.min(...this.sessionDurations) : 0,
            byChannel: { ...this.sessionsByChannel },
        };
    }

    private getChannelMetrics(): ChannelMetrics {
        const activeUsers: Record<string, number> = {};
        for (const [ch, users] of Object.entries(this.activeUsersByChannel)) {
            activeUsers[ch] = users.size;
        }

        const latency: Record<string, number> = {};
        for (const [ch, times] of Object.entries(this.channelLatencies)) {
            latency[ch] = times.length > 0
                ? times.reduce((a, b) => a + b, 0) / times.length : 0;
        }

        return {
            active: Object.keys(this.messagesByChannel).length,
            totalMessages: { ...this.messagesByChannel },
            activeUsers,
            uptime: {}, // Would require external tracking
            errors: { ...this.channelErrors },
            latency,
        };
    }

    private getProviderMetrics(): ProviderMetrics {
        const avgLatency: Record<string, number> = {};
        for (const [p, times] of Object.entries(this.providerLatencies)) {
            avgLatency[p] = times.length > 0
                ? times.reduce((a, b) => a + b, 0) / times.length : 0;
        }

        const availability: Record<string, number> = {};
        for (const p of Object.keys(this.providerRequests)) {
            const total = this.providerRequests[p] || 0;
            const errors = this.providerErrors[p] || 0;
            availability[p] = total > 0 ? ((total - errors) / total) * 100 : 100;
        }

        const tokensByProv: Record<string, { input: number; output: number }> = {};
        for (const [p, t] of Object.entries(this.tokensByProvider)) {
            tokensByProv[p] = { input: t.input, output: t.output };
        }

        return {
            requests: { ...this.providerRequests },
            errors: { ...this.providerErrors },
            avgLatency,
            availability,
            tokensByProvider: tokensByProv,
        };
    }

    private getGatewayMetrics(): GatewayMetrics {
        const currentConnections = Math.max(0, this.counters.wsConnections - this.counters.wsDisconnections);
        const avgResponseTime = this.gatewayResponseTimes.length > 0
            ? this.gatewayResponseTimes.reduce((a, b) => a + b, 0) / this.gatewayResponseTimes.length
            : 0;

        return {
            wsConnections: currentConnections,
            wsMessagesReceived: this.counters.wsMessagesReceived,
            wsMessagesSent: this.counters.wsMessagesSent,
            httpRequests: this.counters.httpRequests,
            httpErrors: this.counters.httpErrors,
            socketioConnections: 0, // Would require Socket.IO tracking
            avgResponseTime,
            peakConnections: this.peakConnectionCount,
            peakConnectionsTimestamp: this.peakConnectionTimestamp,
        };
    }

    private getToolMetrics(): ToolMetrics {
        const byTool: Record<string, { calls: number; success: number; avgTime: number }> = {};
        for (const [name, stats] of Object.entries(this.toolStats)) {
            byTool[name] = {
                calls: stats.calls,
                success: stats.success,
                avgTime: stats.calls > 0 ? stats.totalTime / stats.calls : 0,
            };
        }

        return {
            totalCalls: this.counters.toolCalls,
            successRate: this.counters.toolCalls > 0
                ? (this.counters.toolSuccess / this.counters.toolCalls) * 100 : 100,
            avgExecutionTime: this.counters.toolCalls > 0
                ? Object.values(this.toolStats).reduce((sum, s) => sum + s.totalTime, 0) / this.counters.toolCalls
                : 0,
            byTool,
        };
    }

    private getUsageEstimation(uptimeHours: number, uptimeDays: number): UsageEstimation {
        const totalMessages = this.counters.messagesReceived + this.counters.messagesSent;
        const totalTokens = this.counters.totalTokensInput + this.counters.totalTokensOutput;

        const msgsPerHour = uptimeHours > 0 ? totalMessages / uptimeHours : 0;
        const msgsPerDay = uptimeDays > 0 ? totalMessages / uptimeDays : msgsPerHour * 24;
        const tokensPerHour = uptimeHours > 0 ? totalTokens / uptimeHours : 0;
        const tokensPerDay = uptimeDays > 0 ? totalTokens / uptimeDays : tokensPerHour * 24;
        const costPerHour = uptimeHours > 0 ? this.counters.totalCostUSD / uptimeHours : 0;
        const costPerDay = uptimeDays > 0 ? this.counters.totalCostUSD / uptimeDays : costPerHour * 24;

        // Trend analysis (compare last 24h vs previous 24h)
        const messagesTrend = this.calculateTrend(this.dailyMessages);
        const tokensTrend = this.calculateTrend(this.dailyTokens);
        const costTrend = this.calculateTrend(this.dailyCosts);

        const avgSessionLifetime = this.sessionDurations.length > 0
            ? this.sessionDurations.reduce((a, b) => a + b, 0) / this.sessionDurations.length : 0;

        return {
            messagesPerHour: Math.round(msgsPerHour * 100) / 100,
            messagesPerDay: Math.round(msgsPerDay * 100) / 100,
            messagesPerMonth: Math.round(msgsPerDay * 30 * 100) / 100,
            tokensPerHour: Math.round(tokensPerHour),
            tokensPerDay: Math.round(tokensPerDay),
            tokensPerMonth: Math.round(tokensPerDay * 30),
            costPerHour: Math.round(costPerHour * 10000) / 10000,
            costPerDay: Math.round(costPerDay * 100) / 100,
            costPerMonth: Math.round(costPerDay * 30 * 100) / 100,
            projectedMessages30d: Math.round(msgsPerDay * 30),
            projectedTokens30d: Math.round(tokensPerDay * 30),
            projectedCost30d: Math.round(costPerDay * 30 * 100) / 100,
            activeSessions: this.activeSessions.size,
            peakConcurrentSessions: this.peakConcurrentSessions,
            avgSessionLifetime,
            messagesTrend,
            tokensTrend,
            costTrend,
        };
    }

    private getResourceEstimation(): ResourceEstimation {
        const mem = process.memoryUsage();
        const osTotalMem = os.totalmem();
        const osFreeMem = os.freemem();
        const osUsedMem = osTotalMem - osFreeMem;
        const cpus = os.cpus();
        const loadAvg = os.loadavg();

        const memoryUsedMB = mem.rss / (1024 * 1024);
        const heapUsedMB = mem.heapUsed / (1024 * 1024);
        const heapTotalMB = mem.heapTotal / (1024 * 1024);

        // Current CPU% from latest sample
        const latest = this.resourceSamples[this.resourceSamples.length - 1];
        const cpuPercent = latest?.cpuPercent ?? 0;
        const memoryPercent = osTotalMem > 0 ? (osUsedMem / osTotalMem) * 100 : 0;

        // Averages
        const samples = this.resourceSamples;
        const avgCpu = samples.length > 0 ? samples.reduce((s, r) => s + r.cpuPercent, 0) / samples.length : 0;
        const avgMem = samples.length > 0 ? samples.reduce((s, r) => s + r.memoryPercent, 0) / samples.length : 0;
        const avgHeap = samples.length > 0 ? samples.reduce((s, r) => s + r.heapUsedMB, 0) / samples.length : 0;
        const avgHeapPct = heapTotalMB > 0 ? (avgHeap / heapTotalMB) * 100 : 0;

        // Trends from resource samples
        const cpuTrend = this.calculateResourceTrend(samples.map(s => s.cpuPercent));
        const memTrend = this.calculateResourceTrend(samples.map(s => s.memoryPercent));
        const heapTrend = this.calculateResourceTrend(samples.map(s => s.heapUsedMB));

        // Memory growth projection
        let memoryGrowthMBPerHour = 0;
        let estimatedOOMHours: number | null = null;
        if (samples.length >= 6) {
            const first10 = samples.slice(0, Math.ceil(samples.length / 3));
            const last10 = samples.slice(-Math.ceil(samples.length / 3));
            const avgFirst = first10.reduce((s, r) => s + r.memoryUsedMB, 0) / first10.length;
            const avgLast = last10.reduce((s, r) => s + r.memoryUsedMB, 0) / last10.length;
            const elapsedHours = (samples.length * 10) / 3600; // 10s intervals
            memoryGrowthMBPerHour = elapsedHours > 0 ? (avgLast - avgFirst) / elapsedHours : 0;

            if (memoryGrowthMBPerHour > 0.1) {
                const remainingMB = (osTotalMem / (1024 * 1024)) - memoryUsedMB;
                estimatedOOMHours = Math.round(remainingMB / memoryGrowthMBPerHour);
            }
        }

        // Sparkline data (last 60 samples)
        const sparkSamples = samples.slice(-60);

        return {
            cpuPercent: Math.round(cpuPercent * 100) / 100,
            memoryPercent: Math.round(memoryPercent * 100) / 100,
            memoryUsedMB: Math.round(memoryUsedMB * 100) / 100,
            memoryTotalMB: Math.round(heapTotalMB * 100) / 100,
            heapUsedMB: Math.round(heapUsedMB * 100) / 100,
            heapTotalMB: Math.round(heapTotalMB * 100) / 100,
            heapPercent: heapTotalMB > 0 ? Math.round((heapUsedMB / heapTotalMB) * 10000) / 100 : 0,
            loadAvg: [
                Math.round(loadAvg[0] * 100) / 100,
                Math.round(loadAvg[1] * 100) / 100,
                Math.round(loadAvg[2] * 100) / 100,
            ],
            osTotalMemoryMB: Math.round(osTotalMem / (1024 * 1024)),
            osFreeMemoryMB: Math.round(osFreeMem / (1024 * 1024)),
            osUsedMemoryMB: Math.round(osUsedMem / (1024 * 1024)),
            osMemoryPercent: Math.round(memoryPercent * 100) / 100,
            cpuCount: cpus.length,
            cpuModel: cpus[0]?.model || 'Unknown',

            avgCpuPercent: Math.round(avgCpu * 100) / 100,
            avgMemoryPercent: Math.round(avgMem * 100) / 100,
            avgHeapPercent: Math.round(avgHeapPct * 100) / 100,

            peakCpuPercent: this.peakCpuPercent,
            peakCpuTimestamp: this.peakCpuTimestamp,
            peakMemoryMB: Math.round(this.peakMemoryMB * 100) / 100,
            peakMemoryTimestamp: this.peakMemoryTimestamp,
            peakHeapMB: Math.round(this.peakHeapMB * 100) / 100,
            peakHeapTimestamp: this.peakHeapTimestamp,

            cpuTrend,
            memoryTrend: memTrend,
            heapTrend,

            memoryGrowthMBPerHour: Math.round(memoryGrowthMBPerHour * 100) / 100,
            estimatedOOMHours,

            cpuHistory: sparkSamples.map(s => s.cpuPercent),
            memoryHistory: sparkSamples.map(s => s.memoryPercent),
            heapHistory: sparkSamples.map(s => s.heapUsedMB),
        };
    }

    private calculateResourceTrend(values: number[]): 'increasing' | 'stable' | 'decreasing' {
        if (values.length < 6) return 'stable';
        const mid = Math.floor(values.length / 2);
        const firstHalf = values.slice(0, mid);
        const secondHalf = values.slice(mid);
        const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        const change = avgFirst > 0 ? ((avgSecond - avgFirst) / avgFirst) * 100 : 0;
        if (change > 10) return 'increasing';
        if (change < -10) return 'decreasing';
        return 'stable';
    }

    // ==================== HELPERS ====================

    private pushEvent(type: MetricEvent['type'], data: Record<string, any>): void {
        this.events.push({ type, timestamp: new Date(), data });

        // Bounded buffer — keep events within limit (picoclaw-inspired)
        if (this.events.length > BUFFER_LIMITS.MAX_EVENTS) {
            this.events = this.events.slice(-BUFFER_LIMITS.EVENTS_EVICT_TO);
        }
    }

    private getHourKey(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;
    }

    private getDayKey(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    private checkHourlyPeak(): void {
        const now = new Date();
        if (now.getHours() !== this.currentHourStart.getHours() ||
            now.getDate() !== this.currentHourStart.getDate()) {
            // Hour changed
            if (this.currentHourMessages > this.peakMessagesPerHour) {
                this.peakMessagesPerHour = this.currentHourMessages;
                this.peakHourTimestamp = this.currentHourStart;
            }
            this.currentHourMessages = 0;
            this.currentHourStart = now;
        }
    }

    private getHourlyBreakdown(source: Map<string, number>): HourlyBucket[] {
        const buckets: HourlyBucket[] = [];
        const sorted = Array.from(source.entries()).sort(([a], [b]) => a.localeCompare(b));
        for (const [hour, count] of sorted.slice(-48)) { // Last 48 hours
            buckets.push({ hour, count });
        }
        return buckets;
    }

    private getDailyBreakdown(source: Map<string, number>): DailyBucket[] {
        const buckets: DailyBucket[] = [];
        const sorted = Array.from(source.entries()).sort(([a], [b]) => a.localeCompare(b));
        for (const [date, count] of sorted.slice(-30)) { // Last 30 days
            buckets.push({ date, count });
        }
        return buckets;
    }

    private getDailyBreakdownWithCost(): DailyBucket[] {
        const buckets: DailyBucket[] = [];
        const days = new Set([
            ...this.dailyMessages.keys(),
            ...this.dailyCosts.keys(),
        ]);
        const sorted = Array.from(days).sort().slice(-30);
        for (const date of sorted) {
            buckets.push({
                date,
                count: this.dailyMessages.get(date) || 0,
                tokens: this.dailyTokens.get(date) || 0,
                cost: this.dailyCosts.get(date) || 0,
            });
        }
        return buckets;
    }

    private calculateTrend(dailyData: Map<string, number>): 'increasing' | 'stable' | 'decreasing' {
        const sorted = Array.from(dailyData.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-7); // Last 7 days

        if (sorted.length < 2) return 'stable';

        const midpoint = Math.floor(sorted.length / 2);
        const firstHalf = sorted.slice(0, midpoint);
        const secondHalf = sorted.slice(midpoint);

        const avgFirst = firstHalf.reduce((sum, [, v]) => sum + v, 0) / (firstHalf.length || 1);
        const avgSecond = secondHalf.reduce((sum, [, v]) => sum + v, 0) / (secondHalf.length || 1);

        const changePercent = avgFirst > 0 ? ((avgSecond - avgFirst) / avgFirst) * 100 : 0;

        if (changePercent > 10) return 'increasing';
        if (changePercent < -10) return 'decreasing';
        return 'stable';
    }

    // ==================== PERSISTENCE ====================

    public async persist(): Promise<void> {
        try {
            if (!existsSync(this.dataDir)) {
                await mkdir(this.dataDir, { recursive: true });
            }

            const snapshot = this.getSnapshot();
            const filename = `metrics-${this.getDayKey()}.json`;
            const filepath = join(this.dataDir, filename);

            await writeFile(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');
            log.debug(`Metrics persisted to ${filepath}`);
        } catch (error) {
            log.error('Failed to persist metrics:', error);
        }
    }

    public async loadPersisted(): Promise<MetricsSnapshot | null> {
        try {
            const filename = `metrics-${this.getDayKey()}.json`;
            const filepath = join(this.dataDir, filename);

            if (!existsSync(filepath)) return null;

            const data = await readFile(filepath, 'utf-8');
            return JSON.parse(data) as MetricsSnapshot;
        } catch (error) {
            log.error('Failed to load persisted metrics:', error);
            return null;
        }
    }

    public startAutoPersist(intervalMs: number = 60000): void {
        this.persistTimer = setInterval(() => {
            this.persist().catch((err) => log.error('Auto-persist failed:', err));
        }, intervalMs);
        log.info(`Metrics auto-persist started (every ${intervalMs / 1000}s)`);
    }

    public stopAutoPersist(): void {
        if (this.persistTimer) {
            clearInterval(this.persistTimer);
            this.persistTimer = undefined;
            log.info('Metrics auto-persist stopped');
        }
        if (this.resourceSampleTimer) {
            clearInterval(this.resourceSampleTimer);
            this.resourceSampleTimer = undefined;
        }
    }

    // ==================== RESET ====================

    public reset(): void {
        this.events = [];
        Object.keys(this.counters).forEach((key) => {
            (this.counters as any)[key] = 0;
        });
        this.messagesByChannel = {};
        this.messagesByType = {};
        this.tokensByProvider = {};
        this.tokensByModel = {};
        this.costByProvider = {};
        this.costByModel = {};
        this.providerRequests = {};
        this.providerErrors = {};
        this.sessionsByChannel = {};
        this.channelErrors = {};
        this.activeUsersByChannel = {};
        this.toolStats = {};
        this.providerLatencies = {};
        this.channelLatencies = {};
        this.gatewayResponseTimes = [];
        this.activeSessions.clear();
        this.sessionDurations = [];
        this.sessionMessageCounts.clear();
        this.sessionTokenCounts.clear();
        this.hourlyMessages.clear();
        this.hourlyTokens.clear();
        this.dailyMessages.clear();
        this.dailyTokens.clear();
        this.dailyCosts.clear();
        this.peakConnectionCount = 0;
        this.peakConnectionTimestamp = undefined;
        this.peakMessagesPerHour = 0;
        this.peakHourTimestamp = undefined;
        this.peakConcurrentSessions = 0;
        this.currentHourMessages = 0;
        this.currentHourStart = new Date();
        this.startTime = new Date();
        this.resourceSamples = [];
        this.peakCpuPercent = 0;
        this.peakCpuTimestamp = undefined;
        this.peakMemoryMB = 0;
        this.peakMemoryTimestamp = undefined;
        this.peakHeapMB = 0;
        this.peakHeapTimestamp = undefined;

        log.info('Metrics reset');
    }

    public getRecentEvents(count: number = 100): MetricEvent[] {
        return this.events.slice(-count);
    }
}

// ==================== SINGLETON ====================

let metricsCollector: MetricsCollector | null = null;

export function getMetrics(): MetricsCollector {
    if (!metricsCollector) {
        metricsCollector = new MetricsCollector();
    }
    return metricsCollector;
}

export function createMetrics(dataDir?: string): MetricsCollector {
    metricsCollector = new MetricsCollector(dataDir);
    return metricsCollector;
}

export default MetricsCollector;
