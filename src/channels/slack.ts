/**
 * OpenClaw - Slack Channel
 * Integration with Slack using @slack/bolt
 */

import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
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

export interface SlackConfig extends ChannelConfig {
  slackToken: string;
  signingSecret: string;
  appToken?: string;
  socketMode?: boolean;
  dmPolicy: 'open' | 'pairing' | 'closed';
  allowFrom: string[];
  allowedWorkspaces?: string[];
  allowedChannels?: string[];
}

export class SlackChannel {
  private id: string;
  private config: SlackConfig;
  private app: App;
  private status: ChannelStatus;
  private messageQueue: OutgoingMessage[] = [];
  private processingQueue: boolean = false;
  private botUserId: string | null = null;

  constructor(id: string, config: SlackConfig) {
    this.id = id;
    this.config = config;
    this.status = {
      connected: false,
      connecting: false,
      retryCount: 0,
    };

    const receiver = new ExpressReceiver({
      signingSecret: config.signingSecret,
    });

    this.app = new App({
      token: config.slackToken,
      receiver,
      socketMode: config.socketMode ?? false,
      appToken: config.appToken,
      logLevel: LogLevel.INFO,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Message event
    this.app.message(async ({ message, say, client }) => {
      await this.handleMessage(message, client);
    });

    // App mention event
    this.app.event('app_mention', async ({ event, say, client }) => {
      await this.handleAppMention(event, client);
    });

    // Direct message event
    this.app.event('message.im', async ({ event, client }) => {
      await this.handleDirectMessage(event, client);
    });

    // Command handlers
    this.app.command('/openclaw', async ({ command, ack, say }) => {
      await ack();
      await this.handleSlashCommand(command, say);
    });

    // Error handler
    this.app.error(async (error) => {
      log.error('Slack app error:', error);
      this.status.error = error.message;
    });
  }

  private async handleMessage(message: any, client: any): Promise<void> {
    // Ignore messages from bots
    if (message.subtype === 'bot_message') return;
    if (message.user === this.botUserId) return;

    try {
      const userInfo = await client.users.info({ user: message.user });
      const senderName = userInfo.user?.real_name || userInfo.user?.name || 'Unknown';

      const channelInfo = await client.conversations.info({ channel: message.channel });
      const chatName = channelInfo.channel?.name || 'Unknown';

      const incomingMessage: IncomingMessage = {
        id: generateId(),
        channel: 'slack',
        channelId: this.id,
        senderId: message.user,
        senderName,
        chatId: message.channel,
        chatType: channelInfo.channel?.is_im ? 'direct' :
          channelInfo.channel?.is_group ? 'group' : 'channel',
        chatName,
        content: message.text || '',
        timestamp: new Date(parseFloat(message.ts) * 1000),
        replyTo: message.thread_ts,
        mentions: this.extractMentions(message.text),
        media: this.extractMedia(message),
        raw: message,
      };

      log.info(`Received Slack message from ${senderName}: ${message.text?.substring(0, 50)}...`);

      getGateway().publish('messages', {
        type: 'message:received',
        timestamp: new Date(),
        source: `slack:${this.id}`,
        payload: incomingMessage,
      });
    } catch (error) {
      log.error('Error handling Slack message:', error);
    }
  }

  private async handleAppMention(event: any, client: any): Promise<void> {
    log.info(`App mentioned in channel ${event.channel}`);
    // Handle app mention
  }

  private async handleDirectMessage(event: any, client: any): Promise<void> {
    // Check DM policy
    if (this.config.dmPolicy === 'closed') return;

    await this.handleMessage(event, client);
  }

  private async handleSlashCommand(command: any, say: any): Promise<void> {
    const text = command.text.trim().toLowerCase();

    switch (text) {
      case 'status':
        await say('📊 OpenClaw is online and ready!');
        break;
      case 'help':
        await say(
          '🦞 *OpenClaw Commands*\n\n' +
          '`/openclaw status` - Check bot status\n' +
          '`/openclaw help` - Show this help message'
        );
        break;
      default:
        await say('Unknown command. Try `/openclaw help` for available commands.');
    }
  }

  private extractMentions(text: string): string[] {
    const mentionRegex = /<@([A-Z0-9]+)>/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }

  private extractMedia(message: any): MediaAttachment[] {
    const media: MediaAttachment[] = [];

    if (message.files) {
      for (const file of message.files) {
        media.push({
          type: file.mimetype?.startsWith('image/') ? 'image' :
            file.mimetype?.startsWith('video/') ? 'video' :
              file.mimetype?.startsWith('audio/') ? 'audio' : 'document',
          url: file.url_private,
          mimeType: file.mimetype,
          filename: file.name,
          size: file.size,
        });
      }
    }

    return media;
  }

  public async connect(): Promise<void> {
    if (this.status.connecting || this.status.connected) {
      log.warn(`Slack ${this.id} is already connecting or connected`);
      return;
    }

    this.status.connecting = true;
    log.info('Connecting to Slack...');

    try {
      await this.app.start();

      // Get bot info
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id || null;

      log.info(`Slack app connected: ${auth.user}`);

      this.status.connected = true;
      this.status.connecting = false;
      this.status.lastConnected = new Date();

      this.registerWithGateway();
      this.processMessageQueue();
    } catch (error) {
      log.error('Failed to connect to Slack:', error);
      this.status.connecting = false;
      this.status.error = String(error);
      this.scheduleReconnect();
    }
  }

  public async sendMessage(message: OutgoingMessage): Promise<void> {
    if (!this.status.connected) {
      log.warn('Slack not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      await this.app.client.chat.postMessage({
        channel: message.chatId,
        text: message.content,
        thread_ts: message.replyTo,
      });

      log.info(`Sent Slack message to ${message.chatId}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      log.error('Error sending Slack message:', error);
      this.messageQueue.push(message);
    }
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;
    log.info(`Processing ${this.messageQueue.length} queued Slack messages`);

    while (this.messageQueue.length > 0 && this.status.connected) {
      const message = this.messageQueue.shift()!;
      await this.sendMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.processingQueue = false;
  }

  private scheduleReconnect(): void {
    if (this.status.retryCount >= 5) {
      log.error('Max reconnection attempts reached for Slack');
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, this.status.retryCount), 60000);
    this.status.retryCount++;

    log.info(`Scheduling Slack reconnect in ${delay}ms (attempt ${this.status.retryCount})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private registerWithGateway(): void {
    const channel: Channel = {
      id: this.id,
      type: 'slack',
      name: 'Slack App',
      enabled: true,
      config: this.config,
      status: this.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    getGateway().addChannel(channel);
  }

  public async disconnect(): Promise<void> {
    await this.app.stop();
    this.status.connected = false;
    this.status.connecting = false;
    log.info('Slack disconnected');
  }

  public getStatus(): ChannelStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.connected;
  }
}

export default SlackChannel;
