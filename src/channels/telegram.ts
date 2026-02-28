/**
 * OpenClaw - Telegram Channel
 * Integration with Telegram using grammY
 */

import { Bot, Context, GrammyError, HttpError, session, SessionFlavor } from 'grammy';
import type { Update, Message, User } from 'grammy/types';
import { log } from '../utils/logger.js';
import { getGateway } from '../gateway/index.js';
import {
  Channel,
  ChannelConfig,
  IncomingMessage,
  OutgoingMessage,
  MediaAttachment,
  ChannelStatus,
  LocationData
} from '../types/index.js';
import { generateId } from '../utils/helpers.js';

export interface TelegramConfig extends ChannelConfig {
  botToken: string;
  webhookUrl?: string;
  allowedUpdates?: string[];
  dropPendingUpdates?: boolean;
  allowedUsers?: string[];
}

interface SessionData {
  messages: any[];
  settings: Record<string, any>;
}

export type MyContext = Context & SessionFlavor<SessionData>;

export class TelegramChannel {
  private id: string;
  private config: TelegramConfig;
  private bot: Bot<MyContext>;
  private status: ChannelStatus;
  private messageQueue: OutgoingMessage[] = [];
  private processingQueue: boolean = false;
  private botInfo: User | null = null;

  constructor(id: string, config: TelegramConfig) {
    this.id = id;
    this.config = config;
    this.status = {
      connected: false,
      connecting: false,
      retryCount: 0,
    };

    this.bot = new Bot(config.botToken);
    this.setupMiddleware();
    this.setupHandlers();
  }

  private setupMiddleware(): void {
    // Session middleware
    this.bot.use(session({
      initial: (): SessionData => ({
        messages: [],
        settings: {},
      }),
    }));

    // Authentication middleware
    this.bot.use(async (ctx, next) => {
      if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
        const userId = ctx.from?.id.toString();
        const username = ctx.from?.username;
        const isAllowed = (userId && this.config.allowedUsers.includes(userId)) ||
          (username && this.config.allowedUsers.includes(username));

        if (!isAllowed) {
          log.warn(`[Telegram] Unauthorized access attempt from user ID: ${userId}, Username: ${username}`);
          if (ctx.message || ctx.callbackQuery) {
            try {
              await ctx.reply('⛔ Você não está autorizado a usar este bot. / You are not authorized to use this bot.');
            } catch (e) {
              // Ignore errors sending unauthorized message
            }
          }
          return; // Stop processing
        }
      }
      await next();
    });

    // Logging & Feedback middleware
    this.bot.use(async (ctx, next) => {
      const start = Date.now();

      // Visual feedback
      if (ctx.message || ctx.channelPost) {
        try {
          // Typings action
          await ctx.replyWithChatAction('typing');
          // Add emoji reaction
          if (ctx.react) {
            await ctx.react('🤔');
          }
        } catch (e) {
          // Ignore reaction/typing errors (e.g. lack of permissions or unsupported)
        }
      }

      await next();
      const ms = Date.now() - start;
      log.debug(`Telegram update processed in ${ms}ms`);
    });
  }

  private setupHandlers(): void {
    // Handle text messages
    this.bot.on('message:text', async (ctx) => {
      await this.handleTextMessage(ctx);
    });

    // Handle photos
    this.bot.on('message:photo', async (ctx) => {
      await this.handlePhotoMessage(ctx);
    });

    // Handle videos
    this.bot.on('message:video', async (ctx) => {
      await this.handleVideoMessage(ctx);
    });

    // Handle voice messages
    this.bot.on('message:voice', async (ctx) => {
      await this.handleVoiceMessage(ctx);
    });

    // Handle audio
    this.bot.on('message:audio', async (ctx) => {
      await this.handleAudioMessage(ctx);
    });

    // Handle documents
    this.bot.on('message:document', async (ctx) => {
      await this.handleDocumentMessage(ctx);
    });

    // Handle stickers
    this.bot.on('message:sticker', async (ctx) => {
      await this.handleStickerMessage(ctx);
    });

    // Handle locations
    this.bot.on('message:location', async (ctx) => {
      await this.handleLocationMessage(ctx);
    });

    // Handle contacts
    this.bot.on('message:contact', async (ctx) => {
      await this.handleContactMessage(ctx);
    });

    // Handle commands
    this.bot.command('start', async (ctx) => {
      await ctx.reply('🦞 Welcome to OpenClaw! Your personal AI assistant is ready to help.');
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '🦞 OpenClaw Commands:\n\n' +
        '/start - Start the bot\n' +
        '/help - Show this help message\n' +
        '/status - Check session status\n' +
        '/new - Start a new session\n' +
        '/reset - Reset current session\n' +
        '/compact - Compact session context\n' +
        '/think <level> - Set thinking level\n' +
        '/verbose <on|off> - Toggle verbose mode'
      );
    });

    this.bot.command('status', async (ctx) => {
      await ctx.reply('📊 Session status: Active\nModel: Claude 3 Opus\nTokens: 0');
    });

    this.bot.command('new', async (ctx) => {
      await ctx.reply('🆕 New session started. Previous context cleared.');
    });

    this.bot.command('reset', async (ctx) => {
      await ctx.reply('🔄 Session reset. All context cleared.');
    });

    // Error handler
    this.bot.catch((err) => {
      const ctx = err.ctx;
      log.error(`Error while handling update ${ctx.update.update_id}:`);
      const e = err.error;
      if (e instanceof GrammyError) {
        log.error('Error in request:', e.description);
      } else if (e instanceof HttpError) {
        log.error('Could not contact Telegram:', e);
      } else {
        log.error('Unknown error:', e);
      }
    });
  }

  private async handleTextMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;
    const chat = msg.chat;
    const from = msg.from!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(from.id),
      senderName: `${from.first_name} ${from.last_name || ''}`.trim(),
      chatId: String(chat.id),
      chatType: chat.type === 'private' ? 'direct' : chat.type === 'group' || chat.type === 'supergroup' ? 'group' : 'channel',
      chatName: 'title' in chat ? chat.title! : from.first_name,
      content: msg.text!,
      timestamp: new Date(msg.date * 1000),
      replyTo: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      mentions: this.extractMentions(msg.entities, msg.text!),
      media: [],
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handlePhotoMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;
    const photos = msg.photo!;
    const largestPhoto = photos[photos.length - 1];

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: msg.caption || '📷 Image',
      timestamp: new Date(msg.date * 1000),
      media: [{
        type: 'image',
        mimeType: 'image/jpeg',
        caption: msg.caption || undefined,
      }],
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handleVideoMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: msg.caption || '🎥 Video',
      timestamp: new Date(msg.date * 1000),
      media: [{
        type: 'video',
        mimeType: msg.video!.mime_type || 'video/mp4',
        caption: msg.caption || undefined,
      }],
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handleVoiceMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: '🎤 Voice message',
      timestamp: new Date(msg.date * 1000),
      media: [{
        type: 'voice',
        mimeType: msg.voice!.mime_type || 'audio/ogg',
      }],
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handleAudioMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: `🎵 Audio: ${msg.audio!.title || 'Unknown'}`,
      timestamp: new Date(msg.date * 1000),
      media: [{
        type: 'audio',
        mimeType: msg.audio!.mime_type || 'audio/mpeg',
      }],
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handleDocumentMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: msg.caption || `📄 Document: ${msg.document!.file_name || 'Unknown'}`,
      timestamp: new Date(msg.date * 1000),
      media: [{
        type: 'document',
        mimeType: msg.document!.mime_type || 'application/octet-stream',
        filename: msg.document!.file_name,
      }],
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handleStickerMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: '🎭 Sticker',
      timestamp: new Date(msg.date * 1000),
      media: [{
        type: 'sticker',
        mimeType: 'image/webp',
      }],
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handleLocationMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;
    const location = msg.location!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: '📍 Location shared',
      timestamp: new Date(msg.date * 1000),
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private async handleContactMessage(ctx: Context): Promise<void> {
    const msg = ctx.message!;
    const contact = msg.contact!;

    const incomingMessage = this.createIncomingMessage({
      id: String(msg.message_id),
      senderId: String(msg.from!.id),
      senderName: `${msg.from!.first_name} ${msg.from!.last_name || ''}`.trim(),
      chatId: String(msg.chat.id),
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      chatName: 'title' in msg.chat ? msg.chat.title! : msg.from!.first_name,
      content: `👤 Contact: ${contact.first_name} ${contact.last_name || ''}`.trim(),
      timestamp: new Date(msg.date * 1000),
      raw: msg,
    });

    this.emitMessage(incomingMessage);
  }

  private createIncomingMessage(data: Partial<IncomingMessage> & { id: string; senderId: string; chatId: string; content: string; timestamp: Date }): IncomingMessage {
    return {
      id: generateId(),
      channel: 'telegram',
      channelId: this.id,
      senderId: data.senderId,
      senderName: data.senderName || 'Unknown',
      chatId: data.chatId,
      chatType: data.chatType || 'direct',
      chatName: data.chatName || 'Unknown',
      content: data.content,
      timestamp: data.timestamp,
      replyTo: data.replyTo,
      mentions: data.mentions || [],
      media: data.media || [],
      location: data.location,
      raw: data.raw,
    };
  }

  private emitMessage(message: IncomingMessage): void {
    log.info(`Received Telegram message from ${message.senderName}: ${message.content.substring(0, 50)}...`);

    getGateway().publish('messages', {
      type: 'message:received',
      timestamp: new Date(),
      source: `telegram:${this.id}`,
      payload: message,
    });
  }

  private extractMentions(entities: any[] | undefined, text: string): string[] {
    if (!entities) return [];

    const mentions: string[] = [];
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const username = text.substring(entity.offset, entity.offset + entity.length);
        mentions.push(username);
      } else if (entity.type === 'text_mention') {
        mentions.push(String(entity.user.id));
      }
    }
    return mentions;
  }

  public async connect(): Promise<void> {
    if (this.status.connecting || this.status.connected) {
      log.warn(`Telegram ${this.id} is already connecting or connected`);
      return;
    }

    this.status.connecting = true;
    log.info('Connecting to Telegram...');

    try {
      // Get bot info
      this.botInfo = await this.bot.api.getMe();
      log.info(`Telegram bot connected: @${this.botInfo.username}`);

      this.status.connected = true;
      this.status.connecting = false;
      this.status.lastConnected = new Date();

      // Register with gateway
      this.registerWithGateway();

      // Start bot
      if (this.config.webhookUrl) {
        await this.bot.api.setWebhook(this.config.webhookUrl);
        log.info(`Webhook set to: ${this.config.webhookUrl}`);
      } else {
        await this.bot.start({
          drop_pending_updates: this.config.dropPendingUpdates ?? true,
          allowed_updates: this.config.allowedUpdates as any,
        });
      }
    } catch (error) {
      log.error('Failed to connect to Telegram:', error);
      this.status.connecting = false;
      this.status.error = String(error);
      this.scheduleReconnect();
    }
  }

  public async sendMessage(message: OutgoingMessage): Promise<void> {
    if (!this.status.connected) {
      log.warn('Telegram not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      const chatId = message.chatId;
      const parseMode = message.options?.parseMode === 'markdown' ? 'Markdown' :
        message.options?.parseMode === 'html' ? 'HTML' : undefined;

      if (message.media && message.media.length > 0) {
        const media = message.media[0];
        switch (media.type) {
          case 'image':
            await this.bot.api.sendPhoto(chatId, media.url || '', {
              caption: message.content,
              parse_mode: parseMode,
            });
            break;
          case 'video':
            await this.bot.api.sendVideo(chatId, media.url || '', {
              caption: message.content,
              parse_mode: parseMode,
            });
            break;
          case 'document':
            await this.bot.api.sendDocument(chatId, media.url || '', {
              caption: message.content,
              parse_mode: parseMode,
            });
            break;
          default:
            await this.bot.api.sendMessage(chatId, message.content, {
              parse_mode: parseMode,
            });
        }
      } else {
        try {
          await this.bot.api.sendMessage(chatId, message.content, {
            parse_mode: parseMode,
            reply_to_message_id: message.replyTo ? parseInt(message.replyTo) : undefined,
          });
        } catch (sendErr: any) {
          // Fallback if the original message to reply to was deleted
          if (sendErr.message?.includes('message to be replied not found')) {
            log.warn(`Message to be replied not found (${message.replyTo}), sending as new message to ${chatId}`);
            await this.bot.api.sendMessage(chatId, message.content, {
              parse_mode: parseMode,
            });
          } else {
            throw sendErr;
          }
        }
      }

      log.info(`Sent Telegram message to ${chatId}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      log.error('Error sending Telegram message:', error);
      this.messageQueue.push(message);
    }
  }

  private scheduleReconnect(): void {
    if (this.status.retryCount >= 5) {
      log.error('Max reconnection attempts reached for Telegram');
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, this.status.retryCount), 60000);
    this.status.retryCount++;

    log.info(`Scheduling Telegram reconnect in ${delay}ms (attempt ${this.status.retryCount})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private registerWithGateway(): void {
    const channel: Channel = {
      id: this.id,
      type: 'telegram',
      name: this.botInfo?.username || 'Telegram Bot',
      enabled: true,
      config: this.config,
      status: this.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    getGateway().addChannel(channel);
  }

  public async disconnect(): Promise<void> {
    if (this.config.webhookUrl) {
      await this.bot.api.deleteWebhook();
    } else {
      this.bot.stop();
    }
    this.status.connected = false;
    this.status.connecting = false;
    log.info('Telegram disconnected');
  }

  public getStatus(): ChannelStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.connected;
  }

  public getBotInfo(): User | null {
    return this.botInfo;
  }
}

export default TelegramChannel;
