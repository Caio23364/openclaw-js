/**
 * OpenClaw - Matrix Channel
 * Integration with Matrix using matrix-js-sdk
 */

import * as sdk from 'matrix-js-sdk';
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

export interface MatrixConfig extends ChannelConfig {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  deviceId?: string;
}

export class MatrixChannel {
  private id: string;
  private config: MatrixConfig;
  private client: sdk.MatrixClient;
  private status: ChannelStatus;
  private messageQueue: OutgoingMessage[] = [];
  private processingQueue: boolean = false;
  private synced: boolean = false;

  constructor(id: string, config: MatrixConfig) {
    this.id = id;
    this.config = config;
    this.status = {
      connected: false,
      connecting: false,
      retryCount: 0,
    };

    this.client = sdk.createClient({
      baseUrl: config.homeserverUrl,
      accessToken: config.accessToken,
      userId: config.userId,
      deviceId: config.deviceId,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Sync event
    this.client.on(sdk.ClientEvent.Sync, (state, prevState, data) => {
      log.debug(`Matrix sync state: ${state}`);

      if (state === 'PREPARED') {
        this.synced = true;
        this.status.connected = true;
        this.status.connecting = false;
        this.status.lastConnected = new Date();
        log.info('Matrix client synced and ready');
        this.registerWithGateway();
        this.processMessageQueue();
      } else if (state === 'ERROR') {
        log.error('Matrix sync error:', data);
        this.status.error = String(data);
        this.scheduleReconnect();
      }
    });

    // Room event
    this.client.on(sdk.RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
      if (toStartOfTimeline || !room) return;
      if (event.getType() !== 'm.room.message') return;
      if (event.getSender() === this.config.userId) return;

      this.handleMessageEvent(event, room);
    });

    // Error event
    (this.client as any).on('error', (error: Error) => {
      log.error('Matrix client error:', error);
      this.status.error = error.message;
    });
  }

  private async handleMessageEvent(event: sdk.MatrixEvent, room: sdk.Room): Promise<void> {
    try {
      const content = event.getContent();
      const sender = event.getSender()!;
      const roomId = room.roomId;

      // Get sender display name
      const member = room.getMember(sender);
      const senderName = member?.name || sender;

      const incomingMessage: IncomingMessage = {
        id: generateId(),
        channel: 'matrix',
        channelId: this.id,
        senderId: sender,
        senderName,
        chatId: roomId,
        chatType: room.getJoinedMemberCount() === 2 ? 'direct' : 'group',
        chatName: room.name || roomId,
        content: content.body || '',
        timestamp: new Date(event.getTs()),
        replyTo: content['m.relates_to']?.['m.in_reply_to']?.event_id,
        mentions: this.extractMentions(content),
        media: this.extractMedia(content),
        raw: { event, room },
      };

      log.info(`Received Matrix message from ${senderName}: ${content.body?.substring(0, 50)}...`);

      getGateway().publish('messages', {
        type: 'message:received',
        timestamp: new Date(),
        source: `matrix:${this.id}`,
        payload: incomingMessage,
      });
    } catch (error) {
      log.error('Error handling Matrix message:', error);
    }
  }

  private extractMentions(content: any): string[] {
    const mentions: string[] = [];

    if (content['m.mentions']?.user_ids) {
      mentions.push(...content['m.mentions'].user_ids);
    }

    // Also check for @username mentions in body
    const body = content.body || '';
    const mentionRegex = /@([a-zA-Z0-9._-]+:[a-zA-Z0-9.-]+)/g;
    let match;
    while ((match = mentionRegex.exec(body)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  private extractMedia(content: any): MediaAttachment[] {
    const media: MediaAttachment[] = [];

    const msgtype = content.msgtype;

    if (msgtype === 'm.image') {
      media.push({
        type: 'image',
        url: content.url,
        mimeType: content.info?.mimetype,
        caption: content.body,
      });
    } else if (msgtype === 'm.video') {
      media.push({
        type: 'video',
        url: content.url,
        mimeType: content.info?.mimetype,
        caption: content.body,
      });
    } else if (msgtype === 'm.audio') {
      media.push({
        type: 'audio',
        url: content.url,
        mimeType: content.info?.mimetype,
      });
    } else if (msgtype === 'm.file') {
      media.push({
        type: 'document',
        url: content.url,
        mimeType: content.info?.mimetype,
        filename: content.filename,
      });
    }

    return media;
  }

  public async connect(): Promise<void> {
    if (this.status.connecting || this.status.connected) {
      log.warn(`Matrix ${this.id} is already connecting or connected`);
      return;
    }

    this.status.connecting = true;
    log.info(`Connecting to Matrix: ${this.config.homeserverUrl}`);

    try {
      await this.client.startClient({
        initialSyncLimit: 10,
      });
    } catch (error) {
      log.error('Failed to connect to Matrix:', error);
      this.status.connecting = false;
      this.status.error = String(error);
      this.scheduleReconnect();
    }
  }

  public async sendMessage(message: OutgoingMessage): Promise<void> {
    if (!this.status.connected || !this.synced) {
      log.warn('Matrix not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      const roomId = message.chatId;
      const content: any = {
        msgtype: 'm.text',
        body: message.content,
      };

      // Handle reply
      if (message.replyTo) {
        content['m.relates_to'] = {
          'm.in_reply_to': {
            event_id: message.replyTo,
          },
        };
      }

      // Handle formatted content (Markdown)
      if (message.options?.parseMode === 'markdown') {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = this.markdownToHtml(message.content);
      }

      await this.client.sendEvent(roomId, 'm.room.message' as any, content);

      log.info(`Sent Matrix message to ${roomId}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      log.error('Error sending Matrix message:', error);
      this.messageQueue.push(message);
    }
  }

  private markdownToHtml(markdown: string): string {
    // Simple markdown to HTML conversion
    return markdown
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;
    log.info(`Processing ${this.messageQueue.length} queued Matrix messages`);

    while (this.messageQueue.length > 0 && this.status.connected) {
      const message = this.messageQueue.shift()!;
      await this.sendMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.processingQueue = false;
  }

  private scheduleReconnect(): void {
    if (this.status.retryCount >= 5) {
      log.error('Max reconnection attempts reached for Matrix');
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, this.status.retryCount), 60000);
    this.status.retryCount++;

    log.info(`Scheduling Matrix reconnect in ${delay}ms (attempt ${this.status.retryCount})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private registerWithGateway(): void {
    const channel: Channel = {
      id: this.id,
      type: 'matrix',
      name: `Matrix (${this.config.userId})`,
      enabled: true,
      config: this.config,
      status: this.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    getGateway().addChannel(channel);
  }

  public async disconnect(): Promise<void> {
    await this.client.stopClient();
    this.status.connected = false;
    this.status.connecting = false;
    log.info('Matrix disconnected');
  }

  public getStatus(): ChannelStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.connected;
  }

  public getClient(): sdk.MatrixClient {
    return this.client;
  }
}

export default MatrixChannel;
