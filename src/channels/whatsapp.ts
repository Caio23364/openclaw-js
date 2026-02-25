/**
 * OpenClaw - WhatsApp Channel
 * Integration with WhatsApp using @whiskeysockets/baileys
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  proto,
  WAMessage,
  WASocket,
  AnyMessageContent,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
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
import { generateId, generateShortId } from '../utils/helpers.js';

export interface WhatsAppConfig extends ChannelConfig {
  sessionName: string;
  authStrategy: 'local' | 'remote';
  printQR: boolean;
}

export class WhatsAppChannel {
  private id: string;
  private config: WhatsAppConfig;
  private socket: WASocket | null = null;
  private status: ChannelStatus;
  private messageQueue: OutgoingMessage[] = [];
  private processingQueue: boolean = false;

  constructor(id: string, config: WhatsAppConfig) {
    this.id = id;
    this.config = config;
    this.status = {
      connected: false,
      connecting: false,
      retryCount: 0,
    };
  }

  public async connect(): Promise<void> {
    if (this.status.connecting || this.status.connected) {
      log.warn(`WhatsApp ${this.id} is already connecting or connected`);
      return;
    }

    this.status.connecting = true;
    log.info(`Connecting to WhatsApp: ${this.config.sessionName}`);

    try {
      const { version, isLatest } = await fetchLatestBaileysVersion();
      log.info(`Using Baileys version: ${version.join('.')}, isLatest: ${isLatest}`);

      const { state, saveCreds } = await useMultiFileAuthState(
        `./state/whatsapp-${this.config.sessionName}`
      );

      this.socket = makeWASocket({
        version,
        logger: log as any,
        printQRInTerminal: this.config.printQR !== false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, log as any),
        },
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 30000,
      });

      this.setupEventHandlers(saveCreds);
    } catch (error) {
      log.error(`Failed to connect to WhatsApp: ${error}`);
      this.status.connecting = false;
      this.status.error = String(error);
      this.scheduleReconnect();
    }
  }

  private setupEventHandlers(saveCreds: (creds: any) => Promise<void>): void {
    if (!this.socket) return;

    // Connection update
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && this.config.printQR !== false) {
        log.info('QR Code received, scan with WhatsApp:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        log.info(
          `WhatsApp connection closed due to ${lastDisconnect?.error}, reconnecting: ${shouldReconnect}`
        );

        this.status.connected = false;
        this.status.connecting = false;

        if (shouldReconnect) {
          this.scheduleReconnect();
        }
      } else if (connection === 'open') {
        log.info('WhatsApp connection opened successfully');
        this.status.connected = true;
        this.status.connecting = false;
        this.status.lastConnected = new Date();
        this.status.retryCount = 0;

        // Register with gateway
        this.registerWithGateway();

        // Process queued messages
        this.processMessageQueue();
      }
    });

    // Credentials update
    this.socket.ev.on('creds.update', saveCreds);

    // Messages received
    this.socket.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          await this.handleIncomingMessage(msg);
        }
      }
    });

    // Message status updates
    this.socket.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update.status) {
          log.debug(`Message ${update.key.id} status: ${update.update.status}`);
        }
      }
    });

    // Presence updates
    this.socket.ev.on('presence.update', (update) => {
      log.debug(`Presence update for ${update.id}: ${update.presences}`);
    });
  }

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    try {
      // Ignore status messages and messages from self
      if (msg.key.fromMe || !msg.message) return;

      const sender = msg.key.remoteJid!;
      const senderName = msg.pushName || 'Unknown';
      const messageId = msg.key.id!;
      const timestamp = new Date(msg.messageTimestamp! as number * 1000);

      // Extract message content
      let content = '';
      let media: MediaAttachment[] = [];

      const messageType = Object.keys(msg.message)[0] as keyof proto.IMessage;
      const messageContent = msg.message[messageType];

      switch (messageType) {
        case 'conversation':
          content = msg.message.conversation!;
          break;
        case 'extendedTextMessage':
          content = msg.message.extendedTextMessage!.text!;
          break;
        case 'imageMessage':
          content = msg.message.imageMessage!.caption || '';
          media.push({
            type: 'image',
            mimeType: msg.message.imageMessage!.mimetype!,
            caption: msg.message.imageMessage!.caption || undefined,
          });
          break;
        case 'videoMessage':
          content = msg.message.videoMessage!.caption || '';
          media.push({
            type: 'video',
            mimeType: msg.message.videoMessage!.mimetype!,
            caption: msg.message.videoMessage!.caption || undefined,
          });
          break;
        case 'audioMessage':
          media.push({
            type: msg.message.audioMessage!.ptt ? 'voice' : 'audio',
            mimeType: msg.message.audioMessage!.mimetype!,
          });
          break;
        case 'documentMessage':
          content = msg.message.documentMessage!.caption || '';
          media.push({
            type: 'document',
            mimeType: msg.message.documentMessage!.mimetype!,
            filename: msg.message.documentMessage!.title!,
          });
          break;
        case 'stickerMessage':
          media.push({
            type: 'sticker',
            mimeType: 'image/webp',
          });
          break;
        case 'locationMessage':
          const loc = msg.message.locationMessage!;
          content = loc.comment || 'Location shared';
          break;
        case 'contactMessage':
          content = `Contact: ${msg.message.contactMessage!.displayName}`;
          break;
        default:
          content = `[${messageType}]`;
      }

      // Determine chat type
      const chatType = sender.endsWith('@g.us') ? 'group' : 'direct';

      const incomingMessage: IncomingMessage = {
        id: generateId(),
        channel: 'whatsapp',
        channelId: this.id,
        senderId: sender,
        senderName,
        chatId: sender,
        chatType,
        chatName: chatType === 'group' ? 'Group' : senderName,
        content,
        timestamp,
        replyTo: msg.message.extendedTextMessage?.contextInfo?.stanzaId || undefined,
        mentions: this.extractMentions(content),
        media,
        raw: msg,
      };

      log.info(`Received WhatsApp message from ${senderName}: ${content.substring(0, 50)}...`);

      // Emit to gateway
      getGateway().publish('messages', {
        type: 'message:received',
        timestamp: new Date(),
        source: `whatsapp:${this.id}`,
        payload: incomingMessage,
      });
    } catch (error) {
      log.error('Error handling WhatsApp message:', error);
    }
  }

  private extractMentions(text: string): string[] {
    const mentions: string[] = [];
    const mentionRegex = /@(\d+)/g;
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1] + '@s.whatsapp.net');
    }
    return mentions;
  }

  public async sendMessage(message: OutgoingMessage): Promise<void> {
    if (!this.status.connected || !this.socket) {
      log.warn('WhatsApp not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      const jid = message.chatId;
      let content: AnyMessageContent;

      if (message.media && message.media.length > 0) {
        const media = message.media[0];
        // For media messages, we would need to download/upload the media
        // This is a simplified version
        content = {
          text: message.content,
        };
      } else {
        content = {
          text: message.content,
        };
      }

      await this.socket.sendMessage(jid, content);
      log.info(`Sent WhatsApp message to ${jid}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      log.error('Error sending WhatsApp message:', error);
      this.messageQueue.push(message);
    }
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;
    log.info(`Processing ${this.messageQueue.length} queued messages`);

    while (this.messageQueue.length > 0 && this.status.connected) {
      const message = this.messageQueue.shift()!;
      await this.sendMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limiting
    }

    this.processingQueue = false;
  }

  private scheduleReconnect(): void {
    if (this.status.retryCount >= 5) {
      log.error('Max reconnection attempts reached for WhatsApp');
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, this.status.retryCount), 60000);
    this.status.retryCount++;

    log.info(`Scheduling WhatsApp reconnect in ${delay}ms (attempt ${this.status.retryCount})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private registerWithGateway(): void {
    const channel: Channel = {
      id: this.id,
      type: 'whatsapp',
      name: this.config.sessionName,
      enabled: true,
      config: this.config,
      status: this.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    getGateway().addChannel(channel);
  }

  public async disconnect(): Promise<void> {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
    this.status.connected = false;
    this.status.connecting = false;
    log.info('WhatsApp disconnected');
  }

  public getStatus(): ChannelStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.connected;
  }
}

export default WhatsAppChannel;
