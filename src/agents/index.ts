/**
 * OpenClaw - Agent System
 * Core agent runtime for processing messages and executing tools
 * Includes picoclaw-inspired memory optimizations: session TTL, context limits
 */

import { log } from '../utils/logger.js';
import { getGateway } from '../gateway/index.js';
import { getProviderManager } from '../providers/index.js';
import { getMetrics } from '../metrics/index.js';
import {
  Agent,
  AgentConfig,
  Session,
  Message,
  IncomingMessage,
  OutgoingMessage,
  Tool,
  ToolCall,
  ToolResult,
  ToolContext,
  SessionSettings,
} from '../types/index.js';
import { generateId, StateStore } from '../utils/helpers.js';
import { processMedia } from '../providers/media.js';
import { streamWithModel } from '../providers/streaming.js';
import { chatWithFailover, getFailoverPreset } from '../providers/failover.js';

// Built-in tools
const builtInTools: Tool[] = [
  {
    name: 'system.info',
    description: 'Get system information about OpenClaw',
    parameters: [],
    handler: async () => {
      return {
        success: true,
        data: {
          version: '2026.2.14',
          platform: 'nodejs',
          uptime: process.uptime(),
        },
      };
    },
    requireApproval: false,
    category: 'system',
  },
  {
    name: 'system.time',
    description: 'Get current date and time',
    parameters: [
      {
        name: 'timezone',
        type: 'string',
        description: 'Timezone to use (e.g., UTC, America/New_York)',
        required: false,
      },
    ],
    handler: async (params) => {
      const timezone = params.timezone || 'UTC';
      return {
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          timezone,
        },
      };
    },
    requireApproval: false,
    category: 'system',
  },
  {
    name: 'sessions.list',
    description: 'List all active sessions',
    parameters: [],
    handler: async () => {
      try {
        const gateway = getGateway();
        const sessions = gateway.getClients();
        return {
          success: true,
          data: sessions,
        };
      } catch {
        // Gateway not initialized — return empty list
        return {
          success: true,
          data: [],
        };
      }
    },
    requireApproval: false,
    category: 'session',
  },
  {
    name: 'sessions.send',
    description: 'Send a message to another session and get the response',
    parameters: [
      {
        name: 'sessionId',
        type: 'string',
        description: 'ID of the session to send to',
        required: true,
      },
      {
        name: 'message',
        type: 'string',
        description: 'Message content',
        required: true,
      },
    ],
    handler: async (params) => {
      try {
        const runtime = getAgentRuntime();
        const targetSession = runtime.getSession(params.sessionId);
        if (!targetSession) {
          return { success: false, error: `Session not found: ${params.sessionId}` };
        }

        // Route message through the target session's agent
        const incomingMessage = {
          id: `inter-session-${Date.now()}`,
          channel: targetSession.channel as any,
          channelId: targetSession.channelId,
          senderId: 'agent',
          senderName: 'Agent',
          chatId: targetSession.peerId,
          chatType: 'direct' as any,
          chatName: 'Inter-Session',
          content: params.message,
          timestamp: new Date(),
          mentions: [],
          media: [],
          raw: null,
        };

        const response = await runtime.processMessage(incomingMessage, targetSession.agent);
        return {
          success: true,
          data: { sessionId: params.sessionId, response },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: false,
    category: 'session',
  },
  {
    name: 'sessions.history',
    description: 'Fetch the conversation history/transcript for a session',
    parameters: [
      {
        name: 'sessionId',
        type: 'string',
        description: 'ID of the session to get history for',
        required: true,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Max number of messages to return (default: 20)',
        required: false,
      },
    ],
    handler: async (params) => {
      try {
        const runtime = getAgentRuntime();
        const history = runtime.getSessionHistory(params.sessionId, params.limit || 20);
        return {
          success: true,
          data: history,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: false,
    category: 'session',
  },
  {
    name: 'sessions.spawn',
    description: 'Spawn a new sub-agent session with its own model and system prompt',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Name for the sub-agent',
        required: true,
      },
      {
        name: 'systemPrompt',
        type: 'string',
        description: 'System prompt for the sub-agent',
        required: true,
      },
      {
        name: 'model',
        type: 'string',
        description: 'Model string (e.g. deepseek/deepseek-chat)',
        required: false,
      },
      {
        name: 'message',
        type: 'string',
        description: 'Initial message to send to the sub-agent',
        required: false,
      },
    ],
    handler: async (params) => {
      try {
        const runtime = getAgentRuntime();
        const result = await runtime.spawnSubAgent(params.name, {
          systemPrompt: params.systemPrompt,
          model: params.model,
          initialMessage: params.message,
        });
        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: false,
    category: 'session',
  },
  {
    name: 'web.search',
    description: 'Search the web for information. Returns search results with titles, URLs, and snippets.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query',
        required: true,
      },
      {
        name: 'numResults',
        type: 'number',
        description: 'Number of results to return (default: 5)',
        required: false,
      },
    ],
    handler: async (params) => {
      try {
        // Use DuckDuckGo HTML search (no API key needed)
        const query = encodeURIComponent(params.query);
        const numResults = params.numResults || 5;
        
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`);
        }
        
        const html = await response.text();
        
        // Parse results (simple regex extraction)
        const results: Array<{title: string; url: string; snippet: string}> = [];
        const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        
        while ((match = resultRegex.exec(html)) !== null && results.length < numResults) {
          results.push({
            url: match[1].replace(/&amp;/g, '&'),
            title: match[2].replace(/<[^>]+>/g, ''),
            snippet: match[3].replace(/<[^>]+>/g, '').trim()
          });
        }
        
        return {
          success: true,
          data: {
            query: params.query,
            results: results,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: false,
    category: 'network',
  },
  {
    name: 'web.fetch',
    description: 'Fetch and extract content from a URL. Returns the page text content.',
    parameters: [
      {
        name: 'url',
        type: 'string',
        description: 'URL to fetch',
        required: true,
      },
      {
        name: 'maxLength',
        type: 'number',
        description: 'Maximum characters to return (default: 5000)',
        required: false,
      },
    ],
    handler: async (params) => {
      try {
        const response = await fetch(params.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.status}`);
        }
        
        const html = await response.text();
        
        // Simple HTML to text conversion
        let text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        const maxLength = params.maxLength || 5000;
        if (text.length > maxLength) {
          text = text.substring(0, maxLength) + '\n...[truncated]';
        }
        
        return {
          success: true,
          data: {
            url: params.url,
            content: text,
            length: text.length,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: false,
    category: 'network',
  },
  {
    name: 'shell.execute',
    description: 'Execute a shell command. Use with caution. Returns command output.',
    parameters: [
      {
        name: 'command',
        type: 'string',
        description: 'Command to execute',
        required: true,
      },
      {
        name: 'timeout',
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        required: false,
      },
    ],
    handler: async (params) => {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const timeout = params.timeout || 30000;
        const { stdout, stderr } = await execAsync(params.command, { timeout });
        
        return {
          success: true,
          data: {
            stdout: stdout || '',
            stderr: stderr || '',
            command: params.command,
          },
        };
      } catch (error: any) {
        return { 
          success: false, 
          error: error.message,
          data: {
            stdout: error.stdout || '',
            stderr: error.stderr || '',
          }
        };
      }
    },
    requireApproval: true,
    category: 'system',
  },
  {
    name: 'file.read',
    description: 'Read content from a file. Returns file content as string.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'File path (relative to workspace or absolute)',
        required: true,
      },
      {
        name: 'encoding',
        type: 'string',
        description: 'File encoding (default: utf8)',
        required: false,
      },
    ],
    handler: async (params, context) => {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const { isPathAllowed } = await import('../security/sandbox.js');
        
        // Security check
        const workspace = context.agent.workspace || context.session.workspace || '.';
        if (!isPathAllowed(params.path, workspace)) {
          return { success: false, error: 'Path not allowed by sandbox' };
        }
        
        const content = await fs.readFile(params.path, { encoding: params.encoding || 'utf8' });
        
        return {
          success: true,
          data: {
            path: params.path,
            content: content,
            size: content.length,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: false,
    category: 'file',
  },
  {
    name: 'file.write',
    description: 'Write content to a file. Creates file if it does not exist.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'File path (relative to workspace or absolute)',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Content to write',
        required: true,
      },
      {
        name: 'append',
        type: 'boolean',
        description: 'Append to file instead of overwriting (default: false)',
        required: false,
      },
    ],
    handler: async (params, context) => {
      try {
        const fs = await import('fs/promises');
        const { isPathAllowed } = await import('../security/sandbox.js');
        
        // Security check
        const workspace = context.agent.workspace || context.session.workspace || '.';
        if (!isPathAllowed(params.path, workspace)) {
          return { success: false, error: 'Path not allowed by sandbox' };
        }
        
        if (params.append) {
          await fs.appendFile(params.path, params.content, 'utf8');
        } else {
          await fs.writeFile(params.path, params.content, 'utf8');
        }
        
        return {
          success: true,
          data: {
            path: params.path,
            bytesWritten: params.content.length,
            appended: params.append || false,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: true,
    category: 'file',
  },
  {
    name: 'file.list',
    description: 'List files and directories in a path.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Directory path (default: current directory)',
        required: false,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'List recursively (default: false)',
        required: false,
      },
    ],
    handler: async (params, context) => {
      try {
        const fs = await import('fs/promises');
        const pathModule = await import('path');
        const { isPathAllowed } = await import('../security/sandbox.js');
        
        const targetPath = params.path || '.';
        
        // Security check
        const workspace = context.agent.workspace || context.session.workspace || '.';
        if (!isPathAllowed(targetPath, workspace)) {
          return { success: false, error: 'Path not allowed by sandbox' };
        }
        
        async function listDir(dirPath: string, recursive: boolean): Promise<any[]> {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const result = [];
          
          for (const entry of entries) {
            const fullPath = pathModule.join(dirPath, entry.name);
            const item = {
              name: entry.name,
              path: fullPath,
              type: entry.isDirectory() ? 'directory' : 'file',
            };
            
            if (entry.isDirectory() && recursive) {
              (item as any).children = await listDir(fullPath, recursive);
            }
            
            result.push(item);
          }
          
          return result;
        }
        
        const items = await listDir(targetPath, params.recursive || false);
        
        return {
          success: true,
          data: {
            path: targetPath,
            items: items,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    requireApproval: false,
    category: 'file',
  },
];

// Session TTL defaults (picoclaw-inspired)
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const MAX_CONTEXT_MESSAGES = 50; // Hard cap on context window

export class AgentRuntime {
  private agents: Map<string, Agent>;
  private sessions: Map<string, Session>;
  private tools: Map<string, Tool>;
  private stateStore: StateStore;
  private sessionCleanupTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.agents = new Map();
    this.sessions = new Map();
    this.tools = new Map();
    this.stateStore = new StateStore('agents');

    // Register built-in tools
    for (const tool of builtInTools) {
      this.tools.set(tool.name, tool);
    }

    // Start session TTL cleanup (picoclaw-inspired)
    this.sessionCleanupTimer = setInterval(() => this.cleanupStaleSessions(), SESSION_CLEANUP_INTERVAL_MS);
  }

  /**
   * Auto-detect AI provider based on available API keys in environment.
   */
  private detectProviderFromEnv(): { provider: string; model: string } {
    // Check if AI_MODEL is explicitly provided
    const explicitModel = process.env.AI_MODEL;
    if (explicitModel && explicitModel.trim().length > 0) {
      const modelStr = explicitModel.trim();
      const slashIndex = modelStr.indexOf('/');
      if (slashIndex !== -1) {
        return { provider: modelStr.slice(0, slashIndex), model: modelStr.slice(slashIndex + 1) };
      } else {
        return { provider: 'google', model: modelStr };
      }
    }

    log.error('AI_MODEL environment variable must be explicitly defined (e.g., AI_MODEL=google/gemini-2.0-flash)');
    process.exit(1);
  }

  /**
   * Auto-cleanup inactive sessions to prevent memory leaks.
   * Inspired by picoclaw's bounded resource management.
   */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      const lastActivity = session.lastActivity?.getTime() || session.updatedAt.getTime();
      if (now - lastActivity > SESSION_TTL_MS) {
        this.deleteSession(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info(`Session TTL cleanup: removed ${cleaned} stale sessions`);
    }
  }

  public createAgent(id: string, config: Partial<AgentConfig> = {}): Agent {
    // Auto-detect provider from environment
    const detectedProvider = this.detectProviderFromEnv();
    log.info(`[Agent] Creating agent ${id} with auto-detected provider: ${detectedProvider.provider}`);

    const defaultConfig: AgentConfig = {
      model: detectedProvider.model,
      provider: detectedProvider.provider,
      systemPrompt: `You are OpenClaw, an autonomous AI assistant with access to tools.

When the user asks something, be proactive and use available tools to help:
- Use 'web.search' to find current information on the internet
- Use 'web.fetch' to read content from specific URLs
- Use 'shell.execute' to run commands (requires approval)
- Use 'file.read', 'file.write', 'file.list' to work with files
- Use 'system.time' to get current time

Always use tools when you need:
- Current/real-time information (weather, news, prices, etc.)
- To perform calculations or data processing
- To read or write files
- To search for information online

After using tools, provide a complete answer based on the results.`,
      temperature: 0.7,
      maxTokens: 4096,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      thinkingLevel: 'medium',
      tools: {
        enabled: ['*'],
        disabled: [],
        requireApproval: ['system.run', 'file.delete'],
      },
      skills: [],
      autoCompact: true,
      compactThreshold: 50,
      ...config,
    };

    const agent: Agent = {
      id,
      name: id,
      description: 'OpenClaw AI Agent',
      workspace: 'default',
      config: defaultConfig,
      tools: Array.from(this.tools.keys()),
      skills: [],
      status: {
        active: true,
        sessionCount: 0,
        messageCount: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.agents.set(id, agent);
    log.info(`Created agent: ${id}`);

    // Register with gateway (if initialized)
    try {
      getGateway().addAgent(agent);
    } catch {
      // Gateway not initialized (e.g., CLI mode without gateway) — skip registration
    }

    return agent;
  }

  public getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  public getOrCreateSession(sessionId: string, agentId: string = 'default'): Session {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const agent = this.agents.get(agentId) || this.createAgent(agentId);

    const session: Session = {
      id: sessionId,
      name: `Session ${sessionId}`,
      type: 'main',
      channel: 'web',
      channelId: 'web',
      peerId: sessionId,
      workspace: 'default',
      agent: agentId,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      tokenCount: 0,
      costTotal: 0,
      context: [],
      metadata: {},
      settings: {
        thinkingLevel: agent.config.thinkingLevel,
        verboseLevel: 'off',
        sendPolicy: 'always',
        groupActivation: 'mention',
        usageMode: 'off',
        replyBack: true,
        elevated: false,
        maxContextMessages: 50,
      },
    };

    this.sessions.set(sessionId, session);
    agent.status.sessionCount++;

    // Register with gateway (if initialized)
    try {
      getGateway().addSession(session);
    } catch {
      // Gateway not initialized — skip
    }

    // Record metrics
    getMetrics().recordSessionCreated(sessionId, 'web');

    log.info(`Created session: ${sessionId}`);
    return session;
  }

  public getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  public async processMessage(
    incomingMessage: IncomingMessage,
    agentId: string = 'default'
  ): Promise<string> {
    const sessionId = `${incomingMessage.channel}:${incomingMessage.chatId}`;
    const session = this.getOrCreateSession(sessionId, agentId);
    const agent = this.agents.get(agentId)!;

    log.info(`Processing message in session ${sessionId} with agent ${agentId}`);

    // Process media attachments
    let msgContent = incomingMessage.content || '';
    if (incomingMessage.media && incomingMessage.media.length > 0) {
      const mediaResult = await processMedia(incomingMessage.media);
      if (mediaResult.contextText) {
        msgContent += (msgContent ? '\n\n' : '') + mediaResult.contextText;
      }
    }

    // Add user message to context
    const userMessage: Message = {
      id: generateId(),
      sessionId,
      role: 'user',
      content: msgContent,
      timestamp: new Date(),
      metadata: {
        channel: incomingMessage.channel,
        senderId: incomingMessage.senderId,
        senderName: incomingMessage.senderName,
      },
    };

    session.context.push(userMessage);
    session.messageCount++;
    session.lastActivity = new Date();

    // Record message in metrics
    getMetrics().recordMessageReceived(
      incomingMessage.channel,
      incomingMessage.chatType,
      incomingMessage.senderId
    );
    getMetrics().recordSessionMessage(sessionId);

    // Trim context if needed — preserve system messages (picoclaw-inspired)
    const maxCtx = session.settings.maxContextMessages || MAX_CONTEXT_MESSAGES;
    if (session.context.length > maxCtx) {
      const systemMsgs = session.context.filter(m => m.role === 'system');
      const nonSystemMsgs = session.context.filter(m => m.role !== 'system');
      session.context = [...systemMsgs, ...nonSystemMsgs.slice(-(maxCtx - systemMsgs.length))];
    }

    // Get available tools for this agent
    const availableTools = this.getAvailableTools(agent);

    const providerStart = Date.now();
    const modelString = `${agent.config.provider}/${agent.config.model}`;
    log.info(`[Agent] Using model string: ${modelString} (provider: ${agent.config.provider}, model: ${agent.config.model})`);
    let response;

    // Call AI provider (Stream or Failover)
    if (agent.config.failoverEnabled) {
      response = await chatWithFailover(session.context, {
        preferredModel: modelString,
        config: getFailoverPreset('balanced'),
        systemPrompt: agent.config.systemPrompt,
        temperature: agent.config.temperature,
        maxTokens: agent.config.maxTokens,
        tools: availableTools,
      });
    } else {
      response = await streamWithModel(modelString, session.context, {
        systemPrompt: agent.config.systemPrompt,
        temperature: agent.config.temperature,
        maxTokens: agent.config.maxTokens,
        tools: availableTools,
        sessionId,
      });
    }

    getMetrics().recordProviderRequest(agent.config.provider, Date.now() - providerStart);

    // Record token usage
    if (response.usage) {
      const pricing = this.estimateCost(agent.config.provider, agent.config.model, response.usage.input, response.usage.output);
      getMetrics().recordTokenUsage(
        agent.config.provider,
        agent.config.model,
        response.usage.input,
        response.usage.output,
        pricing,
        sessionId
      );
    }

    // Handle tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Add assistant message with tool calls to context FIRST
      const toolCallMessage: Message = {
        id: generateId(),
        sessionId,
        role: 'assistant',
        content: response.content || '',
        timestamp: new Date(),
        toolCalls: response.toolCalls,
      };
      session.context.push(toolCallMessage);

      const toolResults: ToolResult[] = [];

      for (const toolCall of response.toolCalls) {
        const result = await this.executeTool(toolCall, agent, session, incomingMessage);
        toolResults.push(result);
      }

      // Add tool results to context
      for (let i = 0; i < response.toolCalls.length; i++) {
        const toolCall = response.toolCalls[i];
        const result = toolResults[i];

        session.context.push({
          id: generateId(),
          sessionId,
          role: 'tool',
          content: JSON.stringify(result),
          timestamp: new Date(),
        });
      }

      // Get final response after tool execution
      const finalProviderStart = Date.now();
      let finalResponse;

      if (agent.config.failoverEnabled) {
        finalResponse = await chatWithFailover(session.context, {
          preferredModel: modelString,
          config: getFailoverPreset('balanced'),
          systemPrompt: agent.config.systemPrompt,
          temperature: agent.config.temperature,
          maxTokens: agent.config.maxTokens,
        });
      } else {
        finalResponse = await streamWithModel(modelString, session.context, {
          systemPrompt: agent.config.systemPrompt,
          temperature: agent.config.temperature,
          maxTokens: agent.config.maxTokens,
          sessionId,
        });
      }
      getMetrics().recordProviderRequest(agent.config.provider, Date.now() - finalProviderStart);

      // Add assistant response to context
      const assistantMessage: Message = {
        id: generateId(),
        sessionId,
        role: 'assistant',
        content: finalResponse.content,
        timestamp: new Date(),
        toolCalls: response.toolCalls,
      };

      session.context.push(assistantMessage);

      // Update usage stats
      if (finalResponse.usage) {
        session.tokenCount += finalResponse.usage.input + finalResponse.usage.output;
      }

      agent.status.messageCount++;

      return finalResponse.content;
    }

    // Add assistant response to context
    const assistantMessage: Message = {
      id: generateId(),
      sessionId,
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
    };

    session.context.push(assistantMessage);

    // Update usage stats
    if (response.usage) {
      session.tokenCount += response.usage.input + response.usage.output;
    }

    agent.status.messageCount++;

    // Record message sent metric
    getMetrics().recordMessageSent(session.channel);

    // Update session in gateway (if initialized)
    try {
      getGateway().updateSession(sessionId, session);
    } catch {
      // Gateway not initialized — skip
    }

    return response.content;
  }

  private getAvailableTools(agent: Agent): Tool[] {
    const tools: Tool[] = [];

    for (const [name, tool] of this.tools) {
      if (agent.config.tools.disabled.includes(name)) {
        continue;
      }

      if (agent.config.tools.enabled.includes('*') ||
        agent.config.tools.enabled.includes(name)) {
        tools.push(tool);
      }
    }

    return tools;
  }

  private async executeTool(
    toolCall: ToolCall,
    agent: Agent,
    session: Session,
    incomingMessage: IncomingMessage
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolCall.name}`,
      };
    }

    // Check if approval is required — ENFORCE, do not just log
    if (tool.requireApproval || agent.config.tools.requireApproval.includes(toolCall.name)) {
      log.warn(`Tool ${toolCall.name} requires approval — BLOCKED (no approval mechanism active)`);
      return {
        success: false,
        error: `Tool "${toolCall.name}" requires explicit user approval before execution. ` +
          `This tool is restricted for security. Approval must be granted interactively.`,
      };
    }

    try {
      const context: ToolContext = {
        session,
        agent,
        channel: { id: incomingMessage.channelId } as any,
        message: session.context[session.context.length - 1],
      };

      const toolStart = Date.now();
      const result = await tool.handler(toolCall.arguments, context);
      getMetrics().recordToolCall(toolCall.name, result.success, Date.now() - toolStart);
      return result;
    } catch (error: any) {
      log.error(`Tool execution error for ${toolCall.name}:`, error);
      getMetrics().recordToolCall(toolCall.name, false, 0);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  public registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
    log.info(`Registered tool: ${tool.name}`);
  }

  public unregisterTool(name: string): void {
    this.tools.delete(name);
    log.info(`Unregistered tool: ${name}`);
  }

  public getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  public getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  public getSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /** Alias for getSessions() — used by CLI */
  public getAllSessions(): Session[] {
    return this.getSessions();
  }

  public clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.context = [];
      session.messageCount = 0;
      session.tokenCount = 0;
      session.updatedAt = new Date();
      log.info(`Cleared session: ${sessionId}`);
    }
  }

  public deleteSession(sessionId: string): void {
    getMetrics().recordSessionEnded(sessionId);
    this.sessions.delete(sessionId);
    // Remove from gateway (if initialized)
    try {
      getGateway().removeSession(sessionId);
    } catch {
      // Gateway not initialized — skip
    }
    log.info(`Deleted session: ${sessionId}`);
  }

  /** Delete all sessions — used for /new /reset in CLI */
  public deleteAllSessions(): void {
    for (const sessionId of this.sessions.keys()) {
      this.deleteSession(sessionId);
    }
    log.info('All sessions deleted');
  }

  /**
   * Get conversation history for a session.
   * Returns the last N messages formatted for display.
   */
  public getSessionHistory(
    sessionId: string,
    limit: number = 20
  ): { messages: { role: string; content: string; timestamp?: Date }[]; total: number } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const total = session.context.length;
    const messages = session.context.slice(-limit).map((msg) => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    return { messages, total };
  }

  /**
   * Spawn a sub-agent with its own session, model, and system prompt.
   * Based on OpenClaw's agent-to-agent (sessions_spawn) pattern.
   */
  public async spawnSubAgent(
    name: string,
    options: {
      systemPrompt?: string;
      model?: string;
      parentSessionId?: string;
      initialMessage?: string;
    } = {}
  ): Promise<{ sessionId: string; agentId: string; response?: string }> {
    const agentId = `sub-${name}-${Date.now()}`;

    // Create the sub-agent with custom config
    const agent = this.createAgent(agentId, {
      systemPrompt: options.systemPrompt || `You are a sub-agent named "${name}". Help with your assigned task.`,
      model: options.model || 'claude-3-5-sonnet-20241022',
    });

    // Create a session for this sub-agent
    const sessionId = `sub:${agentId}`;
    const session = this.getOrCreateSession(sessionId, agentId);
    session.type = 'sub' as any;
    session.name = `Sub-Agent: ${name}`;

    // Link to parent if provided
    if (options.parentSessionId) {
      session.metadata.parentSession = options.parentSessionId;
    }

    log.info(`Spawned sub-agent: ${name} (${agentId}) → session ${sessionId}`);

    let response: string | undefined;

    // Send initial message if provided
    if (options.initialMessage) {
      const incomingMessage = {
        id: `spawn-${Date.now()}`,
        channel: 'internal' as any,
        channelId: 'sub-agent',
        senderId: 'parent',
        senderName: 'Parent Agent',
        chatId: sessionId,
        chatType: 'direct' as any,
        chatName: `Sub-Agent: ${name}`,
        content: options.initialMessage,
        timestamp: new Date(),
        mentions: [],
        media: [],
        raw: null,
      };

      response = await this.processMessage(incomingMessage, agentId);
    }

    return { sessionId, agentId, response };
  }

  /**
   * Estimate cost based on provider and model pricing.
   */
  private estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
    // Pricing per 1M tokens (approximate, as of early 2026)
    const pricing: Record<string, Record<string, { input: number; output: number }>> = {
      anthropic: {
        'claude-3-opus-20240229': { input: 15, output: 75 },
        'claude-3-sonnet-20240229': { input: 3, output: 15 },
        'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
        'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
      },
      openai: {
        'gpt-4o': { input: 2.5, output: 10 },
        'gpt-4o-mini': { input: 0.15, output: 0.6 },
        'gpt-4-turbo': { input: 10, output: 30 },
        'o1': { input: 15, output: 60 },
      },
      google: {
        'gemini-2.0-flash': { input: 0.075, output: 0.3 },
        'gemini-2.0-pro': { input: 1.25, output: 5 },
        'gemini-1.5-pro': { input: 1.25, output: 5 },
        'gemini-1.5-flash': { input: 0.075, output: 0.3 },
      },
    };

    const providerPricing = pricing[provider];
    if (!providerPricing) return 0;

    // Try exact match, then partial match
    let modelPricing: { input: number; output: number } | undefined = providerPricing[model];
    if (!modelPricing) {
      const key = Object.keys(providerPricing).find(k => model.includes(k) || k.includes(model));
      if (key) modelPricing = providerPricing[key];
    }
    if (!modelPricing) return 0;

    return (inputTokens * modelPricing.input + outputTokens * modelPricing.output) / 1_000_000;
  }
}

// Singleton instance
let agentRuntime: AgentRuntime | null = null;

export function getAgentRuntime(): AgentRuntime {
  if (!agentRuntime) {
    agentRuntime = new AgentRuntime();
  }
  return agentRuntime;
}

export function createAgentRuntime(): AgentRuntime {
  agentRuntime = new AgentRuntime();
  return agentRuntime;
}

export default AgentRuntime;
