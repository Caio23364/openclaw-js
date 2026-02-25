/**
 * OpenClaw - Type Definitions
 * Core types for the personal AI assistant
 */

// ==================== SESSION TYPES ====================

export interface Session {
  id: string;
  name: string;
  type: 'main' | 'group' | 'direct';
  channel: string;
  channelId: string;
  peerId: string;
  peerName?: string;
  workspace: string;
  agent: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date;
  messageCount: number;
  tokenCount: number;
  costTotal: number;
  context: Message[];
  metadata: Record<string, any>;
  settings: SessionSettings;
}

export interface SessionSettings {
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  verboseLevel: 'off' | 'tokens' | 'full';
  model?: string;
  sendPolicy: 'always' | 'mentions' | 'commands';
  groupActivation: 'mention' | 'always';
  usageMode: 'off' | 'tokens' | 'full';
  replyBack: boolean;
  elevated: boolean;
  maxContextMessages: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  metadata?: MessageMetadata;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface MessageMetadata {
  channel?: string;
  senderId?: string;
  senderName?: string;
  messageId?: string;
  replyTo?: string;
  mediaUrls?: string[];
  location?: LocationData;
  cost?: CostInfo;
  tokens?: TokenInfo;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
}

export interface CostInfo {
  input: number;
  output: number;
  total: number;
  currency: string;
}

export interface TokenInfo {
  input: number;
  output: number;
  total: number;
}

// ==================== CHANNEL TYPES ====================

export type ChannelType =
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'signal'
  | 'imessage'
  | 'bluebubbles'
  | 'msteams'
  | 'matrix'
  | 'zalo'
  | 'zalopersonal'
  | 'googlechat'
  | 'webchat'
  | 'sms'
  | 'email';

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  config: ChannelConfig;
  status: ChannelStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelConfig {
  // WhatsApp
  sessionName?: string;
  authStrategy?: 'local' | 'remote';

  // Telegram
  botToken?: string;
  webhookUrl?: string;
  allowedUpdates?: string[];

  // Discord
  discordToken?: string;
  clientId?: string;
  clientSecret?: string;
  intents?: string[];

  // Slack
  slackToken?: string;
  signingSecret?: string;
  appToken?: string;

  // Signal
  signalCliPath?: string;
  phoneNumber?: string;

  // Matrix
  homeserverUrl?: string;
  accessToken?: string;
  userId?: string;

  // Generic
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;

  // DM/Security settings
  dmPolicy: 'open' | 'pairing' | 'closed';
  allowFrom: string[];
  blockFrom: string[];

  // Routing
  defaultWorkspace: string;
  defaultAgent: string;
}

export interface ChannelStatus {
  connected: boolean;
  connecting: boolean;
  error?: string;
  lastConnected?: Date;
  lastError?: Date;
  retryCount: number;
}

export interface IncomingMessage {
  id: string;
  channel: ChannelType;
  channelId: string;
  senderId: string;
  senderName: string;
  chatId: string;
  chatType: 'direct' | 'group' | 'channel';
  chatName?: string;
  content: string;
  timestamp: Date;
  replyTo?: string;
  mentions: string[];
  media: MediaAttachment[];
  location?: LocationData;
  raw: any;
}

export interface OutgoingMessage {
  channel: ChannelType;
  channelId: string;
  chatId: string;
  content: string;
  replyTo?: string;
  media?: MediaAttachment[];
  options?: MessageOptions;
}

export interface MediaAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'voice' | 'sticker';
  url?: string;
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
  caption?: string;
  size?: number;
}

export interface MessageOptions {
  parseMode?: 'plain' | 'markdown' | 'html';
  replyMarkup?: any;
  silent?: boolean;
  threadId?: string;
}

// ==================== PROVIDER TYPES ====================

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'ollama'
  | 'custom'
  | 'zhipu'
  | 'deepseek'
  | 'gemini'
  | 'groq'
  | 'moonshot'
  | 'qwen'
  | 'nvidia'
  | 'openrouter'
  | 'vllm'
  | 'cerebras'
  | 'volcengine'
  | 'shengsuanyun'
  | 'llamacpp'
  | 'osaurus';

export interface Provider {
  id: string;
  type: ProviderType;
  name: string;
  enabled: boolean;
  config: ProviderConfig;
  models: Model[];
  status: ProviderStatus;
}

export interface ProviderConfig {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  region?: string;
  timeout: number;
  maxRetries: number;
  rateLimit: RateLimitConfig;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  concurrentRequests: number;
}

export interface ProviderStatus {
  available: boolean;
  lastChecked: Date;
  error?: string;
  latency?: number;
}

export interface Model {
  id: string;
  provider: string;
  name: string;
  description?: string;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ModelCapabilities {
  chat: boolean;
  vision: boolean;
  tools: boolean;
  streaming: boolean;
  json: boolean;
  systemPrompt: boolean;
}

export interface ModelPricing {
  input: number;
  output: number;
  currency: string;
}

// ==================== AGENT TYPES ====================

export interface Agent {
  id: string;
  name: string;
  description?: string;
  workspace: string;
  config: AgentConfig;
  tools: string[];
  skills: string[];
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfig {
  model: string;
  provider: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  tools: ToolConfig;
  skills: string[];
  autoCompact: boolean;
  compactThreshold: number;
  failoverEnabled?: boolean;
}

export interface ToolConfig {
  enabled: string[];
  disabled: string[];
  requireApproval: string[];
}

export interface AgentStatus {
  active: boolean;
  lastActive?: Date;
  sessionCount: number;
  messageCount: number;
}

// ==================== TOOL TYPES ====================

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: ToolHandler;
  requireApproval: boolean;
  category: ToolCategory;
}

export type ToolCategory =
  | 'system'
  | 'browser'
  | 'file'
  | 'network'
  | 'media'
  | 'session'
  | 'node';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: any;
  enum?: any[];
}

export type ToolHandler = (params: any, context: ToolContext) => Promise<ToolResult>;

export interface ToolContext {
  session: Session;
  agent: Agent;
  channel: Channel;
  message: Message;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  output?: string;
}

// ==================== SKILL TYPES ====================

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category: SkillCategory;
  tags: string[];
  config: SkillConfig;
  tools: Tool[];
  hooks: SkillHooks;
  enabled: boolean;
  source: SkillSource;
  installedAt: Date;
  updatedAt: Date;
}

export type SkillCategory =
  | 'productivity'
  | 'communication'
  | 'development'
  | 'media'
  | 'automation'
  | 'integration'
  | 'utility';

export type SkillSource = 'bundled' | 'managed' | 'workspace' | 'clawhub';

export interface SkillConfig {
  schema: Record<string, any>;
  values: Record<string, any>;
  required: string[];
}

export interface SkillHooks {
  onInstall?: () => Promise<void>;
  onUninstall?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;
  onMessage?: (message: Message) => Promise<void>;
  onToolCall?: (call: ToolCall) => Promise<void>;
}

// ==================== GATEWAY TYPES ====================

export interface GatewayConfig {
  port: number;
  host: string;
  bind: 'loopback' | 'all';
  auth: AuthConfig;
  tailscale?: TailscaleConfig;
  logging: LoggingConfig;
  cors: CorsConfig;
  /** Allowed WebSocket origins (CVE-2026-25253 fix) */
  originAllowlist?: string[];
  /** Max WebSocket message size in bytes (default: 1MB) */
  maxMessageSize?: number;
  /** Max connections per IP per minute */
  maxConnectionsPerIp?: number;
  /** Max messages per client per minute */
  maxMessagesPerClient?: number;
}

export interface AuthConfig {
  mode: 'none' | 'token' | 'password' | 'oauth';
  token?: string;
  password?: string;
  jwtSecret?: string;
  jwtExpiry: number;
  allowTailscale: boolean;
}

export interface TailscaleConfig {
  mode: 'off' | 'serve' | 'funnel';
  resetOnExit: boolean;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'pretty';
  output: 'console' | 'file' | 'both';
  filePath?: string;
  maxSize: number;
  maxFiles: number;
}

export interface CorsConfig {
  enabled: boolean;
  origins: string[];
  methods: string[];
  headers: string[];
}

export interface WebSocketMessage {
  type: string;
  id: string;
  timestamp: Date;
  payload: any;
}

// ==================== RPC FRAME TYPES (Mission Control Protocol) ====================

/** JSON-RPC-style request frame sent by clients */
export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC-style response frame sent by gateway */
export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: number; message: string };
}

/** Server-sent event frame (pushed to clients) */
export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

// ==================== NODE TYPES (Device Capabilities) ====================

export interface NodeInfo {
  id: string;
  name: string;
  type: 'macos' | 'ios' | 'android' | 'linux' | 'windows';
  capabilities: string[];
  status: 'online' | 'offline';
  version?: string;
  connectedAt: Date;
}

// ==================== CRON TYPES ====================

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  timezone?: string;
  enabled: boolean;
  action: CronAction;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errorCount: number;
  createdAt: Date;
}

export interface CronAction {
  type: 'message' | 'command' | 'webhook' | 'skill';
  target: string;
  payload: any;
}

// ==================== WORKSPACE TYPES ====================

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  owner: string;
  agents: string[];
  channels: string[];
  skills: string[];
  config: WorkspaceConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceConfig {
  defaultAgent: string;
  defaultModel: string;
  allowedChannels: string[];
  allowedSkills: string[];
  maxSessions: number;
  maxTokensPerSession: number;
}

// ==================== USER TYPES ====================

export interface User {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'owner' | 'admin' | 'user' | 'guest';
  channels: UserChannel[];
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserChannel {
  type: ChannelType;
  id: string;
  verified: boolean;
  verifiedAt?: Date;
}

export interface UserPreferences {
  notifications: boolean;
  emailDigest: boolean;
  theme: 'light' | 'dark' | 'system';
  language: string;
  timezone: string;
}

// ==================== BROWSER TYPES ====================

export interface BrowserSession {
  id: string;
  profile: string;
  url?: string;
  status: 'idle' | 'navigating' | 'loading' | 'interactive';
  viewport: ViewportConfig;
  createdAt: Date;
  lastActivity: Date;
}

export interface ViewportConfig {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

// ==================== NODE TYPES ====================

export interface Node {
  id: string;
  name: string;
  type: 'macos' | 'ios' | 'android' | 'linux' | 'windows';
  capabilities: string[];
  status: NodeStatus;
  lastSeen: Date;
  pairedAt: Date;
}

export interface NodeStatus {
  online: boolean;
  battery?: number;
  charging?: boolean;
  version: string;
}

// ==================== EVENT TYPES ====================

export interface OpenClawEvent {
  type: EventType;
  timestamp: Date;
  source: string;
  payload: any;
}

export type EventType =
  | 'message:received'
  | 'message:sent'
  | 'session:created'
  | 'session:updated'
  | 'channel:connected'
  | 'channel:disconnected'
  | 'agent:started'
  | 'agent:stopped'
  | 'tool:called'
  | 'cron:executed'
  | 'error';

// ==================== API RESPONSE TYPES ====================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  stack?: string;
}

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  hasMore?: boolean;
  timestamp: Date;
}
