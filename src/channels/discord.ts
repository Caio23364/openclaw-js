/**
 * OpenClaw - Discord Channel
 * Integration with Discord using discord.js
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Message as DiscordMessage,
  TextChannel,
  DMChannel,
  ThreadChannel,
  NewsChannel,
  EmbedBuilder,
  MessagePayload,
  MessageCreateOptions,
} from 'discord.js';
import { log } from '../utils/logger.js';
import { getGateway } from '../gateway/index.js';
import {
  Channel,
  ChannelConfig,
  IncomingMessage,
  OutgoingMessage,
  MediaAttachment,
  ChannelStatus
} from '../types/index.js';
import { generateId } from '../utils/helpers.js';

export interface DiscordConfig extends ChannelConfig {
  discordToken: string;
  clientId?: string;
  clientSecret?: string;
  intents?: string[];
  dmPolicy: 'open' | 'pairing' | 'closed';
  allowFrom: string[];
  allowedGuilds?: string[];
  allowedChannels?: string[];
  blockedGuilds?: string[];
  blockedChannels?: string[];
}

export class DiscordChannel {
  private id: string;
  private config: DiscordConfig;
  private client: Client;
  private status: ChannelStatus;
  private messageQueue: OutgoingMessage[] = [];
  private processingQueue: boolean = false;
  private stats = { errors: 0, messagesSent: 0, messagesReceived: 0 };

  constructor(id: string, config: DiscordConfig) {
    this.id = id;
    this.config = config;
    this.status = {
      connected: false,
      connecting: false,
      retryCount: 0,
    };

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageTyping,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Ready event
    this.client.once(Events.ClientReady, () => {
      log.info(`Discord bot logged in as ${this.client.user?.tag}`);
      this.status.connected = true;
      this.status.connecting = false;
      this.status.lastConnected = new Date();
      this.status.retryCount = 0;
      this.registerWithGateway();
      this.processMessageQueue();
    });

    // Message create event
    this.client.on(Events.MessageCreate, async (message) => {
      await this.handleIncomingMessage(message);
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      log.error('Discord client error:', error);
      this.status.error = error.message;
      this.stats.errors++;
    });

    // Disconnection handling
    this.client.on(Events.ShardDisconnect, (event, id) => {
      log.warn(`Discord shard ${id} disconnected`);
      this.status.connected = false;
      this.scheduleReconnect();
    });

    // Reconnection handling
    this.client.on(Events.ShardReconnecting, (id) => {
      log.info(`Discord shard ${id} reconnecting...`);
    });

    this.client.on(Events.ShardResume, (id, replayedEvents) => {
      log.info(`Discord shard ${id} resumed, replayed ${replayedEvents} events`);
      this.status.connected = true;
    });
  }

  private async handleIncomingMessage(message: DiscordMessage): Promise<void> {
    try {
      // Ignore messages from bots (including self)
      if (message.author.bot) return;

      // Check DM policy
      if (message.channel.isDMBased()) {
        if (this.config.dmPolicy === 'closed') return;
        if (this.config.dmPolicy === 'pairing') {
          // Would check pairing code here
        }
      }

      // Check guild/channel allowlists
      if (!this.isChannelAllowed(message)) return;

      const senderId = message.author.id;
      const senderName = message.author.username;
      const chatId = message.channelId;
      const chatType = message.channel.isDMBased() ? 'direct' :
        message.channel.isThread() ? 'group' : 'channel';

      // Extract media attachments
      const media: MediaAttachment[] = [];
      message.attachments.forEach((attachment) => {
        const type = this.getMediaType(attachment.contentType);
        media.push({
          type,
          url: attachment.url,
          mimeType: attachment.contentType || undefined,
          filename: attachment.name,
          size: attachment.size,
        });
      });

      const incomingMessage: IncomingMessage = {
        id: generateId(),
        channel: 'discord',
        channelId: this.id,
        senderId,
        senderName,
        chatId,
        chatType,
        chatName: message.channel instanceof TextChannel ? message.channel.name :
          message.channel instanceof DMChannel ? 'DM' :
            message.channel instanceof ThreadChannel ? message.channel.name : 'Unknown',
        content: message.content,
        timestamp: message.createdAt,
        replyTo: message.reference?.messageId,
        mentions: message.mentions.users.map((u) => u.id),
        media,
        raw: message,
      };

      log.info(`Received Discord message from ${senderName}: ${message.content.substring(0, 50)}...`);

      // Emit to gateway
      getGateway().publish('messages', {
        type: 'message:received',
        timestamp: new Date(),
        source: `discord:${this.id}`,
        payload: incomingMessage,
      });

      // Handle commands
      if (message.content.startsWith('!')) {
        await this.handleCommand(message);
      }
    } catch (error) {
      log.error('Error handling Discord message:', error);
    }
  }

  private isChannelAllowed(message: DiscordMessage): boolean {
    // Check guild allowlist
    if (this.config.allowedGuilds && message.guildId) {
      if (!this.config.allowedGuilds.includes(message.guildId)) {
        return false;
      }
    }

    // Check guild blocklist
    if (this.config.blockedGuilds && message.guildId) {
      if (this.config.blockedGuilds.includes(message.guildId)) {
        return false;
      }
    }

    // Check channel allowlist
    if (this.config.allowedChannels) {
      if (!this.config.allowedChannels.includes(message.channelId)) {
        return false;
      }
    }

    // Check channel blocklist
    if (this.config.blockedChannels) {
      if (this.config.blockedChannels.includes(message.channelId)) {
        return false;
      }
    }

    // Check user allowlist
    if (this.config.allowFrom.length > 0 && !this.config.allowFrom.includes('*')) {
      if (!this.config.allowFrom.includes(message.author.id)) {
        return false;
      }
    }

    // Check user blocklist
    if (this.config.blockFrom.includes(message.author.id)) {
      return false;
    }

    return true;
  }

  private getMediaType(contentType: string | null): MediaAttachment['type'] {
    if (!contentType) return 'document';
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
    return 'document';
  }

  private async handleCommand(message: DiscordMessage): Promise<void> {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    switch (command) {
      case 'status':
        await message.reply('📊 OpenClaw is online and ready!');
        break;
      case 'help':
        await message.reply(
          '🦞 **OpenClaw Commands**\n\n' +
          '`!status` - Check bot status\n' +
          '`!help` - Show this help message\n' +
          '`!ping` - Check latency'
        );
        break;
      case 'ping':
        const latency = Date.now() - message.createdTimestamp;
        await message.reply(`🏓 Pong! Latency: ${latency}ms`);
        break;
    }
  }

  public async connect(): Promise<void> {
    if (this.status.connecting || this.status.connected) {
      log.warn(`Discord ${this.id} is already connecting or connected`);
      return;
    }

    this.status.connecting = true;
    log.info('Connecting to Discord...');

    try {
      await this.client.login(this.config.discordToken);
    } catch (error) {
      log.error('Failed to connect to Discord:', error);
      this.status.connecting = false;
      this.status.error = String(error);
      this.scheduleReconnect();
    }
  }

  public async sendMessage(message: OutgoingMessage): Promise<void> {
    if (!this.status.connected) {
      log.warn('Discord not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      const channel = await this.client.channels.fetch(message.chatId);
      if (!channel) {
        log.error(`Discord channel ${message.chatId} not found`);
        return;
      }

      if (!channel.isTextBased()) {
        log.error(`Discord channel ${message.chatId} is not text-based`);
        return;
      }

      const options: MessageCreateOptions = {
        content: message.content,
      };

      if (message.replyTo) {
        options.reply = { messageReference: message.replyTo };
      }

      if (message.media && message.media.length > 0) {
        // For Discord, we'd need to handle file uploads differently
        // This is a simplified version
      }

      await (channel as TextChannel).send(options);
      log.info(`Sent Discord message to ${message.chatId}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      log.error('Error sending Discord message:', error);
      this.messageQueue.push(message);
    }
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;
    log.info(`Processing ${this.messageQueue.length} queued Discord messages`);

    while (this.messageQueue.length > 0 && this.status.connected) {
      const message = this.messageQueue.shift()!;
      await this.sendMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.processingQueue = false;
  }

  private scheduleReconnect(): void {
    if (this.status.retryCount >= 5) {
      log.error('Max reconnection attempts reached for Discord');
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, this.status.retryCount), 60000);
    this.status.retryCount++;

    log.info(`Scheduling Discord reconnect in ${delay}ms (attempt ${this.status.retryCount})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private registerWithGateway(): void {
    const channel: Channel = {
      id: this.id,
      type: 'discord',
      name: this.client.user?.username || 'Discord Bot',
      enabled: true,
      config: this.config,
      status: this.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    getGateway().addChannel(channel);
  }

  public async disconnect(): Promise<void> {
    await this.client.destroy();
    this.status.connected = false;
    this.status.connecting = false;
    log.info('Discord disconnected');
  }

  public getStatus(): ChannelStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.connected;
  }

  public getClient(): Client {
    return this.client;
  }
}

export default DiscordChannel;
