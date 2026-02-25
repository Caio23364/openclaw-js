/**
 * OpenClaw - Channels Index
 * Lazy-loaded channel integrations (picoclaw-inspired optimization)
 * SDKs are only imported when a channel is actually enabled/configured.
 */

// Re-export types only (no SDK loading)
export type { WhatsAppConfig } from './whatsapp.js';
export type { TelegramConfig } from './telegram.js';
export type { DiscordConfig } from './discord.js';
export type { SlackConfig } from './slack.js';
export type { SignalConfig } from './signal.js';
export type { MatrixConfig } from './matrix.js';
export type { WebChatConfig } from './webchat.js';

import { Channel, ChannelType, ChannelConfig, IncomingMessage, OutgoingMessage } from '../types/index.js';
import { log } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';

// Lazy channel type — resolved at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyChannel = any;

export interface ChannelManagerConfig {
  whatsapp?: Record<string, any>;
  telegram?: Record<string, any>;
  discord?: Record<string, any>;
  slack?: Record<string, any>;
  signal?: Record<string, any>;
  matrix?: Record<string, any>;
  webchat?: Record<string, any>;
}

/**
 * Lazy-loads a channel SDK and creates the channel instance.
 * This avoids loading heavy SDKs (discord.js ~40-120MB, puppeteer ~200MB, etc.)
 * until they are actually needed.
 */
async function createChannelInstance(type: string, id: string, config: any): Promise<AnyChannel> {
  switch (type) {
    case 'whatsapp': {
      const { WhatsAppChannel } = await import('./whatsapp.js');
      return new WhatsAppChannel(id, config);
    }
    case 'telegram': {
      const { TelegramChannel } = await import('./telegram.js');
      return new TelegramChannel(id, config);
    }
    case 'discord': {
      const { DiscordChannel } = await import('./discord.js');
      return new DiscordChannel(id, config);
    }
    case 'slack': {
      const { SlackChannel } = await import('./slack.js');
      return new SlackChannel(id, config);
    }
    case 'signal': {
      const { SignalChannel } = await import('./signal.js');
      return new SignalChannel(id, config);
    }
    case 'matrix': {
      const { MatrixChannel } = await import('./matrix.js');
      return new MatrixChannel(id, config);
    }
    case 'webchat': {
      const { WebChatChannel } = await import('./webchat.js');
      return new WebChatChannel(id, config);
    }
    default:
      throw new Error(`Unknown channel type: ${type}`);
  }
}

export class ChannelManager {
  private channels: Map<string, AnyChannel>;
  private config: ChannelManagerConfig;

  constructor() {
    this.channels = new Map();
    this.config = {};
  }

  private async loadConfig(): Promise<ChannelManagerConfig> {
    const config = await getConfig();
    return {
      whatsapp: config.channels.whatsapp as unknown as Record<string, any>,
      telegram: config.channels.telegram as unknown as Record<string, any>,
      discord: config.channels.discord as unknown as Record<string, any>,
      slack: config.channels.slack as unknown as Record<string, any>,
      signal: config.channels.signal as unknown as Record<string, any>,
      matrix: config.channels.matrix as unknown as Record<string, any>,
      webchat: config.channels.webchat as unknown as Record<string, any>,
    };
  }

  public async initialize(): Promise<void> {
    log.info('Initializing channel manager...');
    this.config = await this.loadConfig();

    const channelTypes = ['whatsapp', 'telegram', 'discord', 'slack', 'signal', 'matrix'];
    const initTasks: Promise<void>[] = [];

    for (const type of channelTypes) {
      const configs = this.config[type as keyof ChannelManagerConfig];
      if (!configs) continue;
      for (const [id, config] of Object.entries(configs)) {
        if (config.enabled === false) continue;
        initTasks.push(
          (async () => {
            try {
              log.info(`Lazy-loading ${type} channel: ${id}...`);
              const channel = await createChannelInstance(type, id, config);
              this.channels.set(`${type}:${id}`, channel);
              await channel.connect();
            } catch (error) {
              log.error(`Failed to initialize ${type} channel ${id}:`, error);
            }
          })()
        );
      }
    }

    await Promise.allSettled(initTasks);
    log.info(`Initialized ${this.channels.size} channels (lazy-loaded)`);
  }

  public async addChannel(type: ChannelType, id: string, config: ChannelConfig): Promise<AnyChannel> {
    const channel = await createChannelInstance(type, id, config);
    this.channels.set(`${type}:${id}`, channel);
    await channel.connect();
    return channel;
  }

  public async removeChannel(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (channel) {
      await channel.disconnect();
      this.channels.delete(channelId);
    }
  }

  public getChannel(channelId: string): AnyChannel | undefined {
    return this.channels.get(channelId);
  }

  public getChannelsByType(type: ChannelType): AnyChannel[] {
    return Array.from(this.channels.values()).filter(
      (channel: any) => channel.constructor.name.toLowerCase().includes(type)
    );
  }

  public getAllChannels(): AnyChannel[] {
    return Array.from(this.channels.values());
  }

  public async sendMessage(channelId: string, message: OutgoingMessage): Promise<void> {
    const channel = this.channels.get(channelId);
    if (channel) {
      await channel.sendMessage(message);
    } else {
      throw new Error(`Channel not found: ${channelId}`);
    }
  }

  public async broadcastMessage(message: OutgoingMessage): Promise<void> {
    const tasks = Array.from(this.channels.values()).map(async (channel: any) => {
      try {
        await channel.sendMessage(message);
      } catch (error) {
        log.error(`Failed to broadcast to channel:`, error);
      }
    });
    await Promise.allSettled(tasks);
  }

  public getStatus(): Record<string, any> {
    const status: Record<string, any> = {};
    for (const [id, channel] of this.channels) {
      status[id] = channel.getStatus();
    }
    return status;
  }

  public async disconnectAll(): Promise<void> {
    log.info('Disconnecting all channels...');
    const tasks = Array.from(this.channels.entries()).map(async ([id, channel]: [string, any]) => {
      try {
        await channel.disconnect();
        log.info(`Disconnected channel: ${id}`);
      } catch (error) {
        log.error(`Failed to disconnect channel ${id}:`, error);
      }
    });
    await Promise.allSettled(tasks);
    this.channels.clear();
  }
}

// Singleton instance
let channelManager: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!channelManager) {
    channelManager = new ChannelManager();
  }
  return channelManager;
}

export function createChannelManager(): ChannelManager {
  channelManager = new ChannelManager();
  return channelManager;
}

export default ChannelManager;
