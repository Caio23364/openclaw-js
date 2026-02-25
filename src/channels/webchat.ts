/**
 * OpenClaw - WebChat Channel
 * Browser-based chat interface using Socket.IO
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
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

export interface WebChatConfig extends ChannelConfig {
  namespace?: string;
  requireAuth?: boolean;
  allowedOrigins?: string[];
}

interface WebChatClient {
  id: string;
  socket: Socket;
  userId?: string;
  userName?: string;
  roomId?: string;
  connectedAt: Date;
}

export class WebChatChannel {
  private id: string;
  private config: WebChatConfig;
  private io: SocketIOServer | null = null;
  private clients: Map<string, WebChatClient>;
  private status: ChannelStatus;

  constructor(id: string, config: WebChatConfig) {
    this.id = id;
    this.config = config;
    this.clients = new Map();
    this.status = {
      connected: false,
      connecting: false,
      retryCount: 0,
    };
  }

  public attachToServer(io: SocketIOServer): void {
    this.io = io;
    const namespace = io.of(this.config.namespace || '/webchat');

    namespace.use((socket, next) => {
      // Check origin if configured
      if (this.config.allowedOrigins && this.config.allowedOrigins.length > 0) {
        const origin = socket.handshake.headers.origin;
        if (origin && !this.config.allowedOrigins.includes(origin)) {
          return next(new Error('Origin not allowed'));
        }
      }

      // Check auth if required
      if (this.config.requireAuth) {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication required'));
        }
        // Would validate token here
      }

      next();
    });

    namespace.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    this.status.connected = true;
    this.status.lastConnected = new Date();
    this.registerWithGateway();

    log.info('WebChat channel attached to Socket.IO server');
  }

  private handleConnection(socket: Socket): void {
    const clientId = generateShortId();
    log.info(`WebChat client connected: ${clientId}`);

    const client: WebChatClient = {
      id: clientId,
      socket,
      connectedAt: new Date(),
    };

    this.clients.set(clientId, client);

    // Send welcome message
    socket.emit('connected', {
      clientId,
      timestamp: new Date(),
      message: '🦞 Welcome to OpenClaw WebChat!',
    });

    // Handle join room
    socket.on('join', (data) => {
      const { roomId, userName } = data;
      client.roomId = roomId;
      client.userName = userName || 'Anonymous';
      
      socket.join(roomId);
      socket.to(roomId).emit('user:joined', {
        clientId,
        userName: client.userName,
        timestamp: new Date(),
      });

      log.info(`WebChat client ${clientId} joined room ${roomId}`);
    });

    // Handle leave room
    socket.on('leave', (data) => {
      const { roomId } = data;
      socket.leave(roomId);
      socket.to(roomId).emit('user:left', {
        clientId,
        userName: client.userName,
        timestamp: new Date(),
      });

      log.info(`WebChat client ${clientId} left room ${roomId}`);
    });

    // Handle message
    socket.on('message', async (data) => {
      await this.handleMessage(client, data);
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      if (client.roomId) {
        socket.to(client.roomId).emit('user:typing', {
          clientId,
          userName: client.userName,
          isTyping: data.isTyping,
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      log.info(`WebChat client disconnected: ${clientId}`);
      
      if (client.roomId) {
        socket.to(client.roomId).emit('user:left', {
          clientId,
          userName: client.userName,
          timestamp: new Date(),
        });
      }

      this.clients.delete(clientId);
    });

    // Handle errors
    socket.on('error', (error) => {
      log.error(`WebChat client ${clientId} error:`, error);
    });
  }

  private async handleMessage(client: WebChatClient, data: any): Promise<void> {
    try {
      const { content, roomId, replyTo } = data;

      if (!content || !roomId) {
        client.socket.emit('error', { message: 'Missing content or roomId' });
        return;
      }

      const incomingMessage: IncomingMessage = {
        id: generateId(),
        channel: 'webchat',
        channelId: this.id,
        senderId: client.id,
        senderName: client.userName || 'Anonymous',
        chatId: roomId,
        chatType: 'group',
        chatName: roomId,
        content,
        timestamp: new Date(),
        replyTo,
        mentions: this.extractMentions(content),
        media: data.media || [],
        raw: data,
      };

      log.info(`Received WebChat message from ${client.userName}: ${content.substring(0, 50)}...`);

      // Broadcast to room
      client.socket.to(roomId).emit('message:received', {
        id: incomingMessage.id,
        senderId: client.id,
        senderName: client.userName,
        content,
        timestamp: incomingMessage.timestamp,
        replyTo,
      });

      // Emit to gateway
      getGateway().publish('messages', {
        type: 'message:received',
        timestamp: new Date(),
        source: `webchat:${this.id}`,
        payload: incomingMessage,
      });

      // Acknowledge receipt
      client.socket.emit('message:sent', {
        id: incomingMessage.id,
        timestamp: incomingMessage.timestamp,
      });
    } catch (error) {
      log.error('Error handling WebChat message:', error);
      client.socket.emit('error', { message: 'Failed to process message' });
    }
  }

  private extractMentions(text: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }

  public async sendMessage(message: OutgoingMessage): Promise<void> {
    if (!this.io) {
      log.warn('WebChat not initialized');
      return;
    }

    try {
      const namespace = this.io.of(this.config.namespace || '/webchat');
      
      namespace.to(message.chatId).emit('message:received', {
        id: generateId(),
        senderId: 'openclaw',
        senderName: 'OpenClaw',
        content: message.content,
        timestamp: new Date(),
        replyTo: message.replyTo,
      });

      log.info(`Sent WebChat message to ${message.chatId}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      log.error('Error sending WebChat message:', error);
    }
  }

  public async sendToClient(clientId: string, message: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (client) {
      client.socket.emit('message:received', {
        id: generateId(),
        senderId: 'openclaw',
        senderName: 'OpenClaw',
        ...message,
        timestamp: new Date(),
      });
    }
  }

  public async broadcastToRoom(roomId: string, message: any): Promise<void> {
    if (!this.io) return;

    const namespace = this.io.of(this.config.namespace || '/webchat');
    namespace.to(roomId).emit('broadcast', {
      ...message,
      timestamp: new Date(),
    });
  }

  private registerWithGateway(): void {
    const channel: Channel = {
      id: this.id,
      type: 'webchat',
      name: 'WebChat',
      enabled: true,
      config: this.config,
      status: this.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    getGateway().addChannel(channel);
  }

  public getClients(): WebChatClient[] {
    return Array.from(this.clients.values());
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public getStatus(): ChannelStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.connected;
  }

  public disconnect(): void {
    this.clients.forEach((client) => {
      client.socket.disconnect(true);
    });
    this.clients.clear();
    this.status.connected = false;
    log.info('WebChat disconnected');
  }
}

export default WebChatChannel;
