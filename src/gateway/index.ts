/**
 * OpenClaw - Gateway
 * WebSocket control plane for sessions, channels, tools, and events.
 *
 * Security hardening:
 * - Origin validation (CVE-2026-25253)
 * - Rate limiting per IP/client
 * - Challenge-response authentication
 * - Input validation and size limits
 * - Security headers on HTTP responses
 * - API route authentication middleware
 * - Audit logging for security events
 *
 * Mission Control compatibility:
 * - JSON-RPC frame protocol (req/res/event)
 * - RPC methods: connect, sessions.*, agents.list, node.*
 */

import { createServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { log } from '../utils/logger.js';
import { getGatewayConfig, updateConfig } from '../utils/config.js';
import { generateId, generateShortId } from '../utils/helpers.js';
import { getMetrics } from '../metrics/index.js';
import { generateDashboardHTML } from '../metrics/dashboard.js';
import {
  GatewayConfig,
  WebSocketMessage,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  OpenClawEvent,
  Session,
  Channel,
  Agent,
  NodeInfo,
  ApiResponse,
} from '../types/index.js';
import {
  RateLimiter,
  OriginValidator,
  AuditLogger,
  InputValidator,
  getAuditLogger,
  getConnectionLimiter,
  getMessageLimiter,
  getSecurityHeaders,
  generateNonce,
} from '../security/index.js';
import { parseChatCommand, isChatCommand } from './commands.js';

// ==================== INTERFACES ====================

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  type: 'cli' | 'web' | 'mobile' | 'node' | 'agent';
  authenticated: boolean;
  userId?: string;
  subscriptions: string[];
  connectedAt: Date;
  lastPing: Date;
  remoteAddress: string;
  /** Nonce sent in challenge for this connection */
  nonce?: string;
  /** Client metadata from connect handshake */
  clientInfo?: Record<string, unknown>;
}

interface GatewayStats {
  startTime: Date;
  connections: number;
  messagesReceived: number;
  messagesSent: number;
  sessions: number;
  channels: number;
  errors: number;
  authFailures: number;
  rateLimited: number;
  originBlocked: number;
}

// ==================== GATEWAY CLASS ====================

export class Gateway {
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private wsServer: WebSocketServer;
  private io: SocketIOServer;
  private clients: Map<string, ConnectedClient>;
  private sessions: Map<string, Session>;
  private channels: Map<string, Channel>;
  private agents: Map<string, Agent>;
  private nodes: Map<string, NodeInfo>;
  private config: GatewayConfig;
  private stats: GatewayStats;
  private eventHandlers: Map<string, ((event: OpenClawEvent) => void)[]>;
  private messageHandlers: Map<string, ((client: ConnectedClient, payload: any) => Promise<any>)>;
  private rpcHandlers: Map<string, ((client: ConnectedClient, params: Record<string, unknown>) => Promise<unknown>)>;

  // Security modules
  private originValidator: OriginValidator;
  private connectionLimiter: RateLimiter;
  private messageLimiter: RateLimiter;
  private inputValidator: InputValidator;
  private auditLogger: AuditLogger;

  private constructor(config: GatewayConfig) {
    this.config = config;
    this.clients = new Map();
    this.sessions = new Map();
    this.channels = new Map();
    this.agents = new Map();
    this.nodes = new Map();
    this.eventHandlers = new Map();
    this.messageHandlers = new Map();
    this.rpcHandlers = new Map();
    this.stats = {
      startTime: new Date(),
      connections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      sessions: 0,
      channels: 0,
      errors: 0,
      authFailures: 0,
      rateLimited: 0,
      originBlocked: 0,
    };

    // Initialize security modules
    this.originValidator = new OriginValidator(
      config.originAllowlist ?? config.cors.origins,
      config.bind === 'loopback'
    );
    this.connectionLimiter = new RateLimiter({
      maxRequests: config.maxConnectionsPerIp ?? 20,
      windowMs: 60_000,
      maxBurst: 5,
    });
    this.messageLimiter = new RateLimiter({
      maxRequests: config.maxMessagesPerClient ?? 120,
      windowMs: 60_000,
      maxBurst: 30,
    });
    this.inputValidator = new InputValidator(config.maxMessageSize ?? 1_048_576);
    this.auditLogger = getAuditLogger();

    // Warn if auth is disabled
    if (config.auth.mode === 'none') {
      log.warn('⚠️  SECURITY WARNING: Gateway authentication is disabled (auth.mode = "none").');
      log.warn('   Anyone can connect and execute commands. Set auth.mode to "token" or "password".');
    }

    this.app = express();
    this.setupExpress();

    this.httpServer = createServer(this.app);
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: this.config.cors.origins,
        methods: this.config.cors.methods,
      },
    });

    this.setupWebSocket();
    this.setupSocketIO();
    this.setupMessageHandlers();
    this.setupRpcHandlers();
  }

  /**
   * Async factory — loads config from disk before constructing.
   */
  public static async create(): Promise<Gateway> {
    const config = await getGatewayConfig();
    return new Gateway(config);
  }

  // ==================== EXPRESS SETUP ====================

  private setupExpress(): void {
    // Security headers on ALL responses
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const headers = getSecurityHeaders();
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
      next();
    });

    // Middleware
    this.app.use(cors({
      origin: this.config.cors.origins,
      methods: this.config.cors.methods,
      allowedHeaders: this.config.cors.headers,
    }));
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Health check (no auth required)
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        uptime: Date.now() - this.stats.startTime.getTime(),
        connections: this.clients.size,
        sessions: this.sessions.size,
        channels: this.channels.size,
      });
    });

    // API Routes (with auth middleware)
    this.setupApiRoutes();

    // Error handling
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      log.error('Express error:', err);
      this.stats.errors++;
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
        },
      });
    });
  }

  /**
   * API authentication middleware.
   * Validates Bearer token on all /api/* routes.
   * Same-origin browser requests (no Authorization header, same IP) are
   * allowed when bind is loopback for convenience.
   */
  private apiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Skip auth if disabled
    if (this.config.auth.mode === 'none') {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (this.validateToken(token)) {
        next();
        return;
      }
    }

    // Allow same-origin loopback requests (browser UI)
    const remoteIp = req.ip || req.socket.remoteAddress || '';
    if (this.config.bind === 'loopback' && this.isLoopback(remoteIp) && !authHeader) {
      next();
      return;
    }

    this.auditLogger.record({
      type: 'auth.failure',
      source: remoteIp,
      details: { path: req.path, method: req.method },
    });
    this.stats.authFailures++;
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }

  private validateToken(token: string): boolean {
    if (this.config.auth.mode === 'token' && token === this.config.auth.token) return true;
    if (this.config.auth.mode === 'password' && token === this.config.auth.password) return true;
    return false;
  }

  private isLoopback(address: string): boolean {
    return (
      address === '127.0.0.1' ||
      address === '::1' ||
      address === '::ffff:127.0.0.1' ||
      address === 'localhost'
    );
  }

  private setupApiRoutes(): void {
    // Apply auth middleware to all /api/* routes
    this.app.use('/api', this.apiAuthMiddleware.bind(this));

    // Status endpoint
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        success: true,
        data: {
          version: '2026.2.14',
          uptime: Date.now() - this.stats.startTime.getTime(),
          stats: {
            ...this.stats,
            clients: this.clients.size,
          },
          config: {
            port: this.config.port,
            host: this.config.host,
            bind: this.config.bind,
            authMode: this.config.auth.mode,
          },
        },
      });
    });

    // Sessions endpoints
    this.app.get('/api/sessions', (req: Request, res: Response) => {
      const sessions = Array.from(this.sessions.values());
      res.json({ success: true, data: sessions });
    });

    this.app.get('/api/sessions/:id', (req: Request, res: Response) => {
      const session = this.sessions.get(String(req.params.id));
      if (!session) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        });
      }
      res.json({ success: true, data: session });
    });

    // Channels endpoints
    this.app.get('/api/channels', (req: Request, res: Response) => {
      const channels = Array.from(this.channels.values());
      res.json({ success: true, data: channels });
    });

    this.app.get('/api/channels/:id', (req: Request, res: Response) => {
      const channel = this.channels.get(String(req.params.id));
      if (!channel) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Channel not found' },
        });
      }
      res.json({ success: true, data: channel });
    });

    // Agents endpoints
    this.app.get('/api/agents', (req: Request, res: Response) => {
      const agents = Array.from(this.agents.values());
      res.json({ success: true, data: agents });
    });

    this.app.get('/api/agents/:id', (req: Request, res: Response) => {
      const agent = this.agents.get(String(req.params.id));
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Agent not found' },
        });
      }
      res.json({ success: true, data: agent });
    });

    // Stats endpoint
    this.app.get('/api/stats', (req: Request, res: Response) => {
      res.json({
        success: true,
        data: {
          ...this.stats,
          clients: this.clients.size,
          sessions: this.sessions.size,
          channels: this.channels.size,
          agents: this.agents.size,
        },
      });
    });

    // ==================== METRICS ENDPOINTS ====================

    this.app.get('/api/metrics', (req: Request, res: Response) => {
      try {
        const metrics = getMetrics();
        const snapshot = metrics.getSnapshot();
        res.json({ success: true, data: snapshot });
      } catch (error: any) {
        res.status(500).json({ success: false, error: { code: 'METRICS_ERROR', message: error.message } });
      }
    });

    this.app.get('/api/metrics/estimation', (req: Request, res: Response) => {
      try {
        const metrics = getMetrics();
        const snapshot = metrics.getSnapshot();
        res.json({ success: true, data: snapshot.estimation });
      } catch (error: any) {
        res.status(500).json({ success: false, error: { code: 'METRICS_ERROR', message: error.message } });
      }
    });

    this.app.get('/api/metrics/dashboard', (req: Request, res: Response) => {
      try {
        const metrics = getMetrics();
        const snapshot = metrics.getSnapshot();
        const refreshInterval = parseInt(req.query.refresh as string) || 10;
        const html = generateDashboardHTML(snapshot, refreshInterval);
        res.type('html').send(html);
      } catch (error: any) {
        res.status(500).send(`<h1>Error loading dashboard</h1><p>${error.message}</p>`);
      }
    });

    this.app.get('/api/metrics/events', (req: Request, res: Response) => {
      try {
        const metrics = getMetrics();
        const count = parseInt(req.query.count as string) || 100;
        const events = metrics.getRecentEvents(count);
        res.json({ success: true, data: events });
      } catch (error: any) {
        res.status(500).json({ success: false, error: { code: 'METRICS_ERROR', message: error.message } });
      }
    });

    this.app.post('/api/metrics/reset', (req: Request, res: Response) => {
      try {
        const metrics = getMetrics();
        metrics.reset();
        res.json({ success: true, data: { message: 'Metrics reset successfully' } });
      } catch (error: any) {
        res.status(500).json({ success: false, error: { code: 'METRICS_ERROR', message: error.message } });
      }
    });

    this.app.get('/api/metrics/resources', (req: Request, res: Response) => {
      try {
        const metrics = getMetrics();
        const snapshot = metrics.getSnapshot();
        res.json({ success: true, data: snapshot.resources });
      } catch (error: any) {
        res.status(500).json({ success: false, error: { code: 'METRICS_ERROR', message: error.message } });
      }
    });

    // ==================== SECURITY / AUDIT ENDPOINTS ====================

    this.app.get('/api/security/audit', (req: Request, res: Response) => {
      const count = parseInt(req.query.count as string) || 100;
      const events = this.auditLogger.getRecent(count);
      res.json({ success: true, data: events });
    });

    this.app.get('/api/security/stats', (req: Request, res: Response) => {
      res.json({
        success: true,
        data: {
          authFailures: this.stats.authFailures,
          rateLimited: this.stats.rateLimited,
          originBlocked: this.stats.originBlocked,
          connections: this.clients.size,
        },
      });
    });
  }

  // ==================== WEBSOCKET SETUP ====================

  private setupWebSocket(): void {
    this.wsServer.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const remoteAddress = req.socket.remoteAddress || 'unknown';
      const origin = req.headers.origin || req.headers['sec-websocket-origin'] as string | undefined;

      // ── SECURITY: Origin validation (CVE-2026-25253) ──
      if (!this.originValidator.isAllowed(origin, remoteAddress)) {
        this.stats.originBlocked++;
        this.auditLogger.record({
          type: 'origin.blocked',
          source: remoteAddress,
          details: { origin },
        });
        ws.close(4003, 'Origin not allowed');
        return;
      }

      // ── SECURITY: Rate limit connections per IP ──
      if (!this.connectionLimiter.consume(remoteAddress)) {
        this.stats.rateLimited++;
        this.auditLogger.record({
          type: 'rate_limit.exceeded',
          source: remoteAddress,
          details: { type: 'connection' },
        });
        ws.close(4029, 'Too many connections');
        return;
      }

      const clientId = generateShortId();
      log.info(`New WebSocket connection: ${clientId} from ${remoteAddress}`);

      // Check for query-string token auth
      let preAuthenticated = this.config.auth.mode === 'none';
      if (!preAuthenticated && req.url) {
        try {
          const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const queryToken = url.searchParams.get('token');
          if (queryToken && this.validateToken(queryToken)) {
            preAuthenticated = true;
          }
        } catch {
          // Invalid URL — ignore
        }
      }

      const client: ConnectedClient = {
        id: clientId,
        ws,
        type: 'cli',
        authenticated: preAuthenticated,
        subscriptions: [],
        connectedAt: new Date(),
        lastPing: new Date(),
        remoteAddress,
      };

      this.clients.set(clientId, client);
      this.stats.connections++;
      getMetrics().recordWsConnection();

      this.auditLogger.record({
        type: 'connection.open',
        source: remoteAddress,
        details: { clientId, origin, preAuthenticated },
      });

      // ── SECURITY: Challenge-response auth ──
      // Send challenge event (Mission Control protocol)
      const nonce = generateNonce();
      client.nonce = nonce;
      this.sendRaw(ws, {
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce },
      });

      // Also send legacy connected message for backward compatibility
      this.sendToClient(client, {
        type: 'connected',
        id: generateId(),
        timestamp: new Date(),
        payload: {
          clientId,
          version: '2026.2.14',
          authRequired: this.config.auth.mode !== 'none',
        },
      });

      ws.on('message', async (data: Buffer) => {
        try {
          // ── SECURITY: Input size validation ──
          const validation = this.inputValidator.validateRawMessage(data);
          if (!validation.valid) {
            this.auditLogger.record({
              type: 'input.rejected',
              source: remoteAddress,
              details: { reason: validation.error, size: data.length },
            });
            this.sendToClient(client, {
              type: 'error',
              id: generateId(),
              timestamp: new Date(),
              payload: { message: validation.error },
            });
            return;
          }

          // ── SECURITY: Rate limit messages per client ──
          if (!this.messageLimiter.consume(clientId)) {
            this.stats.rateLimited++;
            this.auditLogger.record({
              type: 'rate_limit.exceeded',
              source: remoteAddress,
              details: { type: 'message', clientId },
            });
            this.sendToClient(client, {
              type: 'error',
              id: generateId(),
              timestamp: new Date(),
              payload: { message: 'Rate limit exceeded. Slow down.' },
            });
            return;
          }

          const raw = data.toString();
          let message: any;
          try {
            message = JSON.parse(raw);
          } catch {
            this.sendToClient(client, {
              type: 'error',
              id: generateId(),
              timestamp: new Date(),
              payload: { message: 'Invalid JSON' },
            });
            return;
          }

          // ── SECURITY: Input structure validation ──
          const msgValidation = this.inputValidator.validateMessage(message);
          if (!msgValidation.valid) {
            this.auditLogger.record({
              type: 'input.rejected',
              source: remoteAddress,
              details: { reason: msgValidation.error },
            });
            this.sendToClient(client, {
              type: 'error',
              id: generateId(),
              timestamp: new Date(),
              payload: { message: msgValidation.error },
            });
            return;
          }

          this.stats.messagesReceived++;
          getMetrics().recordWsMessage('in');

          // Route: JSON-RPC request frame (Mission Control protocol)
          if (message.type === 'req') {
            await this.handleRpcRequest(client, message as RequestFrame);
            return;
          }

          // Route: Legacy protocol
          await this.handleMessage(client, message as WebSocketMessage);
        } catch (error) {
          log.error('Failed to handle WebSocket message:', error);
          this.stats.errors++;
          this.sendToClient(client, {
            type: 'error',
            id: generateId(),
            timestamp: new Date(),
            payload: { message: 'Internal server error' },
          });
        }
      });

      // Ping/pong for keepalive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      ws.on('close', () => {
        log.info(`WebSocket connection closed: ${clientId}`);
        clearInterval(pingInterval);
        this.clients.delete(clientId);
        getMetrics().recordWsDisconnection();
        this.auditLogger.record({
          type: 'connection.close',
          source: remoteAddress,
          details: { clientId },
        });
      });

      ws.on('error', (error) => {
        log.error(`WebSocket error for client ${clientId}:`, error);
        clearInterval(pingInterval);
        this.stats.errors++;
      });
    });
  }

  // ==================== JSON-RPC HANDLER (Mission Control) ====================

  /**
   * Handle an RPC request frame (type: 'req').
   * Dispatches to registered RPC handlers and sends back a ResponseFrame.
   */
  private async handleRpcRequest(client: ConnectedClient, req: RequestFrame): Promise<void> {
    log.debug(`RPC request: ${req.method} from ${client.id}`);

    // 'connect' method is special — it handles auth
    if (req.method === 'connect') {
      await this.handleRpcConnect(client, req);
      return;
    }

    // All other methods require authentication
    if (!client.authenticated) {
      this.sendRpcResponse(client, req.id, false, undefined, {
        code: 401,
        message: 'Not authenticated. Send a "connect" request first.',
      });
      return;
    }

    const handler = this.rpcHandlers.get(req.method);
    if (!handler) {
      this.sendRpcResponse(client, req.id, false, undefined, {
        code: -32601,
        message: `Unknown method: ${req.method}`,
      });
      return;
    }

    try {
      const result = await handler(client, req.params ?? {});
      this.sendRpcResponse(client, req.id, true, result);
    } catch (error: any) {
      log.error(`RPC error for ${req.method}:`, error);
      this.sendRpcResponse(client, req.id, false, undefined, {
        code: -32000,
        message: error.message || 'Internal error',
      });
    }
  }

  /**
   * Handle the 'connect' RPC method — challenge-response authentication.
   */
  private async handleRpcConnect(client: ConnectedClient, req: RequestFrame): Promise<void> {
    const params = req.params ?? {};
    const auth = params.auth as Record<string, unknown> | undefined;
    const clientInfo = params.client as Record<string, unknown> | undefined;

    // Validate token
    let authSuccess = this.config.auth.mode === 'none';

    if (!authSuccess && auth) {
      const token = auth.token as string | undefined;
      const password = auth.password as string | undefined;

      if (token && this.validateToken(token)) {
        authSuccess = true;
      } else if (password && this.config.auth.mode === 'password' && password === this.config.auth.password) {
        authSuccess = true;
      }
    }

    if (authSuccess) {
      client.authenticated = true;
      client.clientInfo = clientInfo ?? {};
      client.type = (clientInfo?.mode as ConnectedClient['type']) || 'cli';

      this.auditLogger.record({
        type: 'auth.success',
        source: client.remoteAddress,
        details: { clientId: client.id, clientInfo },
      });

      // hello-ok snapshot (Mission Control protocol)
      const uptimeMs = Date.now() - this.stats.startTime.getTime();
      this.sendRpcResponse(client, req.id, true, {
        clientId: client.id,
        version: '2026.2.14',
        protocol: 3,
        server: { name: 'openclaw-js', platform: process.platform },
        // hello-ok fields for native apps
        presence: Array.from(this.clients.values())
          .filter(c => c.authenticated)
          .map(c => ({ id: c.id, type: c.type, connectedAt: c.connectedAt })),
        health: {
          status: 'ok',
          uptimeMs,
          sessions: this.sessions.size,
          channels: this.channels.size,
          agents: this.agents.size,
          nodes: this.nodes.size,
        },
        stateVersion: Date.now(),
        uptimeMs,
        limits: {
          maxMessageSize: this.config.maxMessageSize ?? 1048576,
          maxConnectionsPerIp: this.config.maxConnectionsPerIp ?? 10,
          maxMessagesPerClient: this.config.maxMessagesPerClient ?? 60,
        },
        policy: {
          authMode: this.config.auth.mode,
          sandbox: true,
        },
      });
    } else {
      this.stats.authFailures++;
      this.auditLogger.record({
        type: 'auth.failure',
        source: client.remoteAddress,
        details: { clientId: client.id, method: 'connect' },
      });

      this.sendRpcResponse(client, req.id, false, undefined, {
        code: 401,
        message: 'Authentication failed',
      });
    }
  }

  /**
   * Setup RPC method handlers (Mission Control compatible).
   */
  private setupRpcHandlers(): void {
    // ── sessions.list ──
    this.rpcHandlers.set('sessions.list', async (_client, _params) => {
      return Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        channel: s.channel,
        peer: s.peerId,
        model: s.settings?.model ?? null,
        status: 'active',
        name: s.name,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        messageCount: s.messageCount,
      }));
    });

    // ── sessions.history ──
    this.rpcHandlers.set('sessions.history', async (_client, params) => {
      const sessionId = params.session_id as string;
      if (!sessionId) throw new Error('session_id is required');

      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      return (session.context ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));
    });

    // ── sessions.send ──
    this.rpcHandlers.set('sessions.send', async (_client, params) => {
      const sessionId = params.session_id as string;
      const content = params.content as string;
      if (!sessionId || !content) throw new Error('session_id and content are required');

      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      // ── Chat command interception ──
      if (isChatCommand(content)) {
        const isOwner = params.owner === true;
        const result = parseChatCommand(content, session, isOwner);

        if (result.handled) {
          // Apply session settings updates
          if (result.sessionUpdates) {
            for (const [key, value] of Object.entries(result.sessionUpdates)) {
              if (value !== undefined) {
                (session.settings as any)[key] = value;
              }
            }
            session.updatedAt = new Date();
          }

          // Handle actions
          if (result.action === 'reset') {
            session.context = [];
            session.messageCount = 0;
            session.tokenCount = 0;
            session.costTotal = 0;
            session.updatedAt = new Date();
          } else if (result.action === 'compact') {
            const originalCount = session.context.length;
            if (originalCount > 10) {
              const kept = session.context.slice(-10);
              session.context = [
                { id: generateId(), sessionId, role: 'system', content: `[Compacted: ${originalCount - 10} earlier messages removed]`, timestamp: new Date() },
                ...kept,
              ];
            }
            session.updatedAt = new Date();
          }

          // Emit the response as a chat event
          this.emitChatEvent(sessionId, 'assistant', result.response || '', { command: true });

          return {
            success: true,
            command: true,
            response: result.response,
            action: result.action,
          };
        }
      }

      // Sanitize content
      const sanitized = this.inputValidator.sanitizeString(content);

      // Add message to session context
      const message = {
        id: generateId(),
        sessionId,
        role: 'user' as const,
        content: sanitized,
        timestamp: new Date(),
      };
      session.context.push(message);
      session.messageCount++;
      session.lastActivity = new Date();

      this.publish('sessions', {
        type: 'message:received',
        timestamp: new Date(),
        source: 'gateway',
        payload: { sessionId, message },
      });

      // Emit chat event for connected apps
      this.emitChatEvent(sessionId, 'user', sanitized);

      return { success: true, messageId: message.id };
    });

    // ── sessions.create ──
    this.rpcHandlers.set('sessions.create', async (_client, params) => {
      const channel = (params.channel as string) || 'webchat';
      const peer = params.peer as string | undefined;

      const session: Session = {
        id: generateId(),
        name: peer ? `${channel}:${peer}` : `${channel}:${generateShortId(4)}`,
        type: 'direct',
        channel,
        channelId: channel,
        peerId: peer || 'anonymous',
        workspace: 'default',
        agent: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        tokenCount: 0,
        costTotal: 0,
        context: [],
        metadata: {},
        settings: {
          thinkingLevel: 'medium',
          verboseLevel: 'off',
          sendPolicy: 'always',
          groupActivation: 'mention',
          usageMode: 'off',
          replyBack: true,
          elevated: false,
          maxContextMessages: 50,
        },
      };

      this.addSession(session);
      return session;
    });

    // ── sessions.patch ──
    this.rpcHandlers.set('sessions.patch', async (_client, params) => {
      const sessionId = params.session_id as string;
      if (!sessionId) throw new Error('session_id is required');

      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      // Only allow patching safe fields
      // Security: 'elevated' is NOT client-settable (CVE-2026-25253 hardening)
      const allowedFields = ['thinkingLevel', 'verboseLevel', 'model', 'sendPolicy', 'groupActivation'];
      for (const field of allowedFields) {
        if (field in params && field !== 'session_id') {
          (session.settings as any)[field] = params[field];
        }
      }
      session.updatedAt = new Date();

      return { success: true, session };
    });

    // ── agents.list ──
    // Mission Control expects: { requester, allowAny, agents: [...] }
    this.rpcHandlers.set('agents.list', async (client, _params) => {
      const agents = Array.from(this.agents.values()).map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        model: a.config?.model,
        provider: a.config?.provider,
        status: a.status?.active ? 'active' : 'standby',
        workspace: a.workspace,
        tools: a.tools,
        skills: a.skills,
      }));

      return {
        requester: client.id,
        allowAny: true,
        agents,
      };
    });

    // ── node.list ──
    this.rpcHandlers.set('node.list', async (_client, _params) => {
      return Array.from(this.nodes.values()).map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        capabilities: n.capabilities,
        status: n.status,
        version: n.version,
        connectedAt: n.connectedAt,
      }));
    });

    // ── node.describe ──
    this.rpcHandlers.set('node.describe', async (_client, params) => {
      const nodeId = params.node_id as string;
      if (!nodeId) throw new Error('node_id is required');

      const node = this.nodes.get(nodeId);
      if (!node) throw new Error('Node not found');

      return node;
    });

    // ── ping (RPC variant) ──
    this.rpcHandlers.set('ping', async (client, _params) => {
      client.lastPing = new Date();
      return { pong: true, timestamp: new Date() };
    });

    // ── node.invoke ── (dispatch command to a connected device node)
    this.rpcHandlers.set('node.invoke', async (client, params) => {
      const nodeId = params.node_id as string;
      const action = params.action as string;
      const actionParams = params.params as Record<string, unknown> | undefined;

      if (!nodeId || !action) throw new Error('node_id and action are required');

      const node = this.nodes.get(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);

      // Check node capabilities
      if (node.capabilities && !node.capabilities.includes(action.split('.')[0])) {
        throw new Error(`Node "${node.name}" does not support action: ${action}`);
      }

      // Find the WebSocket client for this node
      const nodeClient = Array.from(this.clients.values()).find(
        c => c.type === 'node' && c.clientInfo?.nodeId === nodeId
      );

      if (!nodeClient || nodeClient.ws.readyState !== WebSocket.OPEN) {
        throw new Error(`Node "${node.name}" is not connected`);
      }

      // Forward the invoke request to the node
      const invokeId = generateId();
      this.sendRaw(nodeClient.ws, {
        type: 'req',
        id: invokeId,
        method: 'invoke',
        params: { action, params: actionParams },
      });

      // Return accepted status — result comes back via events
      return {
        status: 'accepted',
        invokeId,
        nodeId,
        action,
      };
    });

    // ── sessions.compact ── (summarize and trim context)
    this.rpcHandlers.set('sessions.compact', async (_client, params) => {
      const sessionId = params.session_id as string;
      if (!sessionId) throw new Error('session_id is required');

      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      const originalCount = session.context.length;
      // Keep only last 10 messages + add summary prefix
      if (session.context.length > 10) {
        const summary = `[Compacted: ${originalCount - 10} earlier messages removed]`;
        const kept = session.context.slice(-10);
        session.context = [
          { id: generateId(), sessionId, role: 'system', content: summary, timestamp: new Date() },
          ...kept,
        ];
      }

      session.updatedAt = new Date();
      return {
        success: true,
        original: originalCount,
        compacted: session.context.length,
      };
    });

    // ── sessions.reset ── (clear session context)
    this.rpcHandlers.set('sessions.reset', async (_client, params) => {
      const sessionId = params.session_id as string;
      if (!sessionId) throw new Error('session_id is required');

      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      session.context = [];
      session.messageCount = 0;
      session.tokenCount = 0;
      session.costTotal = 0;
      session.updatedAt = new Date();

      return { success: true, sessionId };
    });
  }

  // ==================== LEGACY MESSAGE HANDLERS ====================

  private setupSocketIO(): void {
    this.io.on('connection', (socket) => {
      log.info(`New Socket.IO connection: ${socket.id}`);

      socket.on('subscribe', (channel: string) => {
        socket.join(channel);
        socket.emit('subscribed', { channel });
      });

      socket.on('unsubscribe', (channel: string) => {
        socket.leave(channel);
        socket.emit('unsubscribed', { channel });
      });

      socket.on('message', async (data: any, callback) => {
        try {
          const result = await this.processSocketMessage(socket, data);
          if (callback) callback({ success: true, data: result });
        } catch (error: any) {
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('disconnect', () => {
        log.info(`Socket.IO disconnected: ${socket.id}`);
      });
    });
  }

  private setupMessageHandlers(): void {
    // Authentication (legacy)
    this.messageHandlers.set('auth', async (client, payload) => {
      if (this.config.auth.mode === 'token' && payload.token === this.config.auth.token) {
        client.authenticated = true;
        client.userId = payload.userId;
        this.auditLogger.record({
          type: 'auth.success',
          source: client.remoteAddress,
          details: { clientId: client.id, method: 'legacy' },
        });
        return { success: true, message: 'Authenticated' };
      }
      if (this.config.auth.mode === 'password' && payload.password === this.config.auth.password) {
        client.authenticated = true;
        client.userId = payload.userId;
        this.auditLogger.record({
          type: 'auth.success',
          source: client.remoteAddress,
          details: { clientId: client.id, method: 'legacy' },
        });
        return { success: true, message: 'Authenticated' };
      }

      this.stats.authFailures++;
      this.auditLogger.record({
        type: 'auth.failure',
        source: client.remoteAddress,
        details: { clientId: client.id, method: 'legacy' },
      });
      return { success: false, message: 'Authentication failed' };
    });

    // Ping
    this.messageHandlers.set('ping', async (client, _payload) => {
      client.lastPing = new Date();
      return { success: true, timestamp: new Date() };
    });

    // Subscribe to events
    this.messageHandlers.set('subscribe', async (client, payload) => {
      const { channel } = payload;
      if (!client.subscriptions.includes(channel)) {
        client.subscriptions.push(channel);
      }
      return { success: true, channel };
    });

    // Unsubscribe from events
    this.messageHandlers.set('unsubscribe', async (client, payload) => {
      const { channel } = payload;
      client.subscriptions = client.subscriptions.filter((c) => c !== channel);
      return { success: true, channel };
    });

    // Get sessions
    this.messageHandlers.set('sessions.list', async (_client, _payload) => {
      return { success: true, sessions: Array.from(this.sessions.values()) };
    });

    // Get channels
    this.messageHandlers.set('channels.list', async (_client, _payload) => {
      return { success: true, channels: Array.from(this.channels.values()) };
    });

    // Get agents
    this.messageHandlers.set('agents.list', async (_client, _payload) => {
      return { success: true, agents: Array.from(this.agents.values()) };
    });
  }

  private async handleMessage(client: ConnectedClient, message: WebSocketMessage): Promise<void> {
    log.debug(`Received message type: ${message.type} from ${client.id}`);

    if (!client.authenticated && message.type !== 'auth') {
      this.sendToClient(client, {
        type: 'error',
        id: generateId(),
        timestamp: new Date(),
        payload: { message: 'Not authenticated' },
      });
      return;
    }

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        const result = await handler(client, message.payload);
        this.sendToClient(client, {
          type: `${message.type}:response`,
          id: message.id,
          timestamp: new Date(),
          payload: result,
        });
      } catch (error: any) {
        log.error(`Error handling message ${message.type}:`, error);
        this.sendToClient(client, {
          type: 'error',
          id: message.id,
          timestamp: new Date(),
          payload: { message: error.message },
        });
      }
    } else {
      this.sendToClient(client, {
        type: 'error',
        id: message.id,
        timestamp: new Date(),
        payload: { message: `Unknown message type: ${message.type}` },
      });
    }
  }

  private async processSocketMessage(socket: any, data: any): Promise<any> {
    return { received: true };
  }

  // ==================== SEND HELPERS ====================

  /** Send a raw JSON object (no wrapping) */
  private sendRaw(ws: WebSocket, data: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      this.stats.messagesSent++;
      getMetrics().recordWsMessage('out');
    }
  }

  /** Send a legacy-format WebSocketMessage */
  private sendToClient(client: ConnectedClient, message: WebSocketMessage): void {
    this.sendRaw(client.ws, message as unknown as Record<string, unknown>);
  }

  /** Send an RPC response frame */
  private sendRpcResponse(
    client: ConnectedClient,
    id: string,
    ok: boolean,
    payload?: unknown,
    error?: { code: number; message: string }
  ): void {
    const response: ResponseFrame = { type: 'res', id, ok };
    if (ok) {
      response.payload = payload;
    } else {
      response.ok = false;
      response.error = error;
    }
    this.sendRaw(client.ws, response as unknown as Record<string, unknown>);
  }

  // ==================== PUB/SUB ====================

  public broadcast(message: WebSocketMessage, filter?: (client: ConnectedClient) => boolean): void {
    this.clients.forEach((client) => {
      if (!filter || filter(client)) {
        this.sendToClient(client, message);
      }
    });
  }

  /**
   * Emit a typed event to all authenticated clients (Mission Control protocol).
   * Events: agent, chat, presence, tick, health, heartbeat, shutdown.
   */
  public emitEvent(eventName: string, payload: Record<string, unknown>): void {
    const frame: EventFrame = {
      type: 'event',
      event: eventName,
      payload,
    };
    this.clients.forEach((client) => {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        this.sendRaw(client.ws, frame as unknown as Record<string, unknown>);
      }
    });
  }

  /** Emit a chat event (new message in a session) */
  public emitChatEvent(sessionId: string, role: string, content: string, metadata?: Record<string, unknown>): void {
    this.emitEvent('chat', {
      sessionId,
      role,
      content,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }

  /** Emit an agent event (streaming response token) */
  public emitAgentEvent(sessionId: string, delta: string, done: boolean = false): void {
    this.emitEvent('agent', {
      sessionId,
      delta,
      done,
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit a presence event (client connected/disconnected) */
  public emitPresenceEvent(clientId: string, status: 'online' | 'offline', clientType: string): void {
    this.emitEvent('presence', {
      clientId,
      status,
      clientType,
      timestamp: new Date().toISOString(),
    });
  }

  public publish(channel: string, event: OpenClawEvent): void {
    this.broadcast(
      {
        type: 'event',
        id: generateId(),
        timestamp: new Date(),
        payload: { channel, event },
      },
      (client) => client.subscriptions.includes(channel)
    );

    this.io.to(channel).emit('event', event);

    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          log.error('Event handler error:', error);
        }
      });
    }
  }

  public onEvent(type: string, handler: (event: OpenClawEvent) => void): void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, []);
    }
    this.eventHandlers.get(type)!.push(handler);
  }

  // ==================== SESSION/CHANNEL/AGENT MANAGEMENT ====================

  public addSession(session: Session): void {
    this.sessions.set(session.id, session);
    this.stats.sessions++;
    this.publish('sessions', {
      type: 'session:created',
      timestamp: new Date(),
      source: 'gateway',
      payload: session,
    });
  }

  public getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  public updateSession(id: string, updates: Partial<Session>): void {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, updates, { updatedAt: new Date() });
      this.sessions.set(id, session);
    }
  }

  public removeSession(id: string): void {
    this.sessions.delete(id);
    this.stats.sessions = Math.max(0, this.stats.sessions - 1);
  }

  public addChannel(channel: Channel): void {
    this.channels.set(channel.id, channel);
    this.stats.channels++;
    this.publish('channels', {
      type: 'channel:connected',
      timestamp: new Date(),
      source: 'gateway',
      payload: channel,
    });
  }

  public getChannel(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  public updateChannel(id: string, updates: Partial<Channel>): void {
    const channel = this.channels.get(id);
    if (channel) {
      Object.assign(channel, updates, { updatedAt: new Date() });
      this.channels.set(id, channel);
    }
  }

  public removeChannel(id: string): void {
    this.channels.delete(id);
    this.stats.channels = Math.max(0, this.stats.channels - 1);
  }

  public addAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.publish('agents', {
      type: 'agent:started',
      timestamp: new Date(),
      source: 'gateway',
      payload: agent,
    });
  }

  public getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  public removeAgent(id: string): void {
    this.agents.delete(id);
  }

  public addNode(node: NodeInfo): void {
    this.nodes.set(node.id, node);
  }

  public removeNode(id: string): void {
    this.nodes.delete(id);
  }

  public getStats(): GatewayStats {
    return { ...this.stats };
  }

  public getClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  public getAuditLog(): AuditLogger {
    return this.auditLogger;
  }

  // ==================== LIFECYCLE ====================

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        log.info(`🚀 Gateway started on ${this.config.host}:${this.config.port}`);
        log.info(`📊 WebSocket: ws://${this.config.host}:${this.config.port}`);
        log.info(`🌐 API: http://${this.config.host}:${this.config.port}`);
        log.info(`🔒 Auth: ${this.config.auth.mode} | Origin check: enabled | Rate limiting: enabled`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      this.clients.forEach((client) => {
        client.ws.close();
      });
      this.clients.clear();

      // Close Socket.IO connections
      this.io.close();

      // Clean up security modules
      this.connectionLimiter.destroy();
      this.messageLimiter.destroy();

      // Close HTTP server
      this.httpServer.close(() => {
        log.info('Gateway stopped');
        resolve();
      });
    });
  }
}

// Singleton instance
let gateway: Gateway | null = null;

export function getGateway(): Gateway {
  if (!gateway) {
    throw new Error('Gateway not initialized. Call createGateway() first.');
  }
  return gateway;
}

export async function createGateway(): Promise<Gateway> {
  gateway = await Gateway.create();
  return gateway;
}

export default Gateway;
