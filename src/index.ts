/**
 * OpenClaw - Main Entry Point
 * Your own personal AI assistant. Any OS. Any Platform. The lobster way. 🦞
 */

import { getGateway, createGateway } from './gateway/index.js';
import { getChannelManager, createChannelManager } from './channels/index.js';
import { getProviderManager, createProviderManager } from './providers/index.js';
import { getAgentRuntime, createAgentRuntime } from './agents/index.js';
import { getCronManager, createCronManager } from './cron/index.js';
import { getBrowserManager, createBrowserManager } from './browser/index.js';
import { getSkillManager, createSkillManager } from './skills/index.js';
import { getMetrics, createMetrics } from './metrics/index.js';
import { getHeartbeatManager, createHeartbeatManager } from './heartbeat/index.js';
import { log } from './utils/logger.js';
import { loadConfig, ensureDirectories } from './utils/config.js';

export { getGateway, createGateway } from './gateway/index.js';
export { getChannelManager, createChannelManager } from './channels/index.js';
export { getProviderManager, createProviderManager } from './providers/index.js';
export { getAgentRuntime, createAgentRuntime } from './agents/index.js';
export { getCronManager, createCronManager } from './cron/index.js';
export { getBrowserManager, createBrowserManager } from './browser/index.js';
export { getSkillManager, createSkillManager } from './skills/index.js';
export { getMetrics, createMetrics } from './metrics/index.js';
export { getHeartbeatManager, createHeartbeatManager } from './heartbeat/index.js';
export * from './types/index.js';
export * from './utils/index.js';

export interface OpenClawOptions {
  gateway?: boolean;
  channels?: boolean;
  providers?: boolean;
  agents?: boolean;
  cron?: boolean;
  browser?: boolean;
}

export class OpenClaw {
  private options: OpenClawOptions;
  private started: boolean;

  constructor(options: OpenClawOptions = {}) {
    this.options = {
      gateway: true,
      channels: true,
      providers: true,
      agents: true,
      cron: true,
      browser: false,
      ...options,
    };
    this.started = false;
  }

  public async start(): Promise<void> {
    if (this.started) {
      log.warn('OpenClaw is already started');
      return;
    }

    log.info('🦞 Starting OpenClaw...');

    // Ensure directories exist
    await ensureDirectories();

    // Load configuration
    const config = await loadConfig();
    log.info('Configuration loaded');

    // Initialize metrics
    const metrics = createMetrics();
    metrics.startAutoPersist(60000);
    log.info('Metrics system initialized');

    // Initialize providers
    if (this.options.providers) {
      const providerManager = await createProviderManager();
      log.info(`Initialized ${providerManager.getAllProviders().length} providers`);
    }

    // Start gateway FIRST (agents need it)
    if (this.options.gateway) {
      const gateway = await createGateway();
      await gateway.start();
      log.info('Gateway started');
    }

    // Initialize agents AFTER gateway
    if (this.options.agents) {
      const agentRuntime = createAgentRuntime();
      agentRuntime.createAgent('default');
      log.info('Agent runtime initialized');
    }

    // Connect Gateway events to AgentRuntime for message processing
    // MUST be done BEFORE initializing channels to not miss any messages
    if (this.options.gateway && this.options.agents) {
      const gateway = getGateway();
      const agentRuntime = getAgentRuntime();
      
      gateway.onEvent('message:received', async (event) => {
        const message = event.payload as any;
        log.info(`[Gateway] Received event: message:received from ${message?.channel}`);
        if (!message) {
          log.warn('[Gateway] Empty message payload');
          return;
        }
        
        log.info(`[Gateway] Processing message from ${message.senderName}: ${message.content?.substring(0, 50)}`);
        
        try {
          // Process message and get response
          log.info(`[Gateway] Calling agentRuntime.processMessage with agent: ${message.agent || 'default'}`);
          const response = await agentRuntime.processMessage(message, message.agent || 'default');
          log.info(`[Gateway] Got response: ${response?.substring(0, 50)}...`);
          
          // Send response back through the channel
          if (response && message.chatId) {
            const channelManager = getChannelManager();
            const channelId = `${message.channel}:${message.channelId}`;
            log.info(`[Gateway] Looking for channel: ${channelId}`);
            const channel = channelManager.getChannel(channelId);
            if (channel && channel.sendMessage) {
              log.info(`[Gateway] Sending response to ${message.chatId}`);
              await channel.sendMessage({
                chatId: message.chatId,
                content: response,
                replyTo: message.id,
              });
              log.info('[Gateway] Response sent successfully');
            } else {
              log.error(`[Gateway] Channel not found or no sendMessage method: ${channelId}`);
            }
          } else {
            log.warn(`[Gateway] No response or chatId. Response: ${!!response}, chatId: ${message.chatId}`);
          }
        } catch (error) {
          log.error('[Gateway] Error processing message:', error);
        }
      });
      
      log.info('Gateway connected to AgentRuntime');
    }

    // Initialize channels (AFTER event handlers are registered)
    if (this.options.channels) {
      const channelManager = createChannelManager();
      await channelManager.initialize();
      log.info('Channels initialized');
    }

    // Start cron
    if (this.options.cron) {
      const cronManager = createCronManager();
      cronManager.startAll();
      log.info('Cron jobs started');
    }

    // Initialize heartbeat (picoclaw-inspired)
    if (config.heartbeat?.enabled) {
      const heartbeat = createHeartbeatManager();
      await heartbeat.initialize();
      log.info('Heartbeat system started');
    }

    this.started = true;
    log.info('🦞 OpenClaw is ready!');
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    log.info('Stopping OpenClaw...');

    // Stop each subsystem independently — one failure shouldn't block others
    try {
      const gateway = getGateway();
      await gateway.stop();
    } catch (error) {
      log.error('Error stopping gateway:', error);
    }

    try {
      const channelManager = getChannelManager();
      await channelManager.disconnectAll();
    } catch (error) {
      log.error('Error disconnecting channels:', error);
    }

    try {
      const cronManager = getCronManager();
      cronManager.stopAll();
    } catch (error) {
      log.error('Error stopping cron:', error);
    }

    try {
      const metrics = getMetrics();
      metrics.stopAutoPersist();
      await metrics.persist();
    } catch (error) {
      log.error('Error stopping metrics:', error);
    }

    try {
      const browserManager = getBrowserManager();
      await browserManager.closeAll();
    } catch (error) {
      log.error('Error closing browsers:', error);
    }

    try {
      const heartbeat = getHeartbeatManager();
      heartbeat.stop();
    } catch (error) {
      // Heartbeat may not have been initialized — ignore
    }

    this.started = false;
    log.info('OpenClaw stopped');
  }

  public isStarted(): boolean {
    return this.started;
  }
}

// Default export
export default OpenClaw;

// If running directly
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
if (__filename === resolve(process.argv[1])) {
  const openclaw = new OpenClaw();

  openclaw.start().catch((error) => {
    log.error('Failed to start OpenClaw:', error);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await openclaw.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await openclaw.stop();
    process.exit(0);
  });
}
