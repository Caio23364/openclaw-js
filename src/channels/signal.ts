/**
 * OpenClaw - Signal Channel
 * Integration with Signal using signal-cli
 */

import { spawn, ChildProcess } from 'child_process';
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

export interface SignalConfig extends ChannelConfig {
  signalCliPath: string;
  phoneNumber: string;
  dataPath?: string;
}

export class SignalChannel {
  private id: string;
  private config: SignalConfig;
  private process: ChildProcess | null = null;
  private status: ChannelStatus;
  private messageQueue: OutgoingMessage[] = [];
  private processingQueue: boolean = false;

  constructor(id: string, config: SignalConfig) {
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
      log.warn(`Signal ${this.id} is already connecting or connected`);
      return;
    }

    this.status.connecting = true;
    log.info(`Connecting to Signal: ${this.config.phoneNumber}`);

    try {
      // Start signal-cli daemon
      this.process = spawn(this.config.signalCliPath, [
        'daemon',
        '--username', this.config.phoneNumber,
        '--receive-mode', 'on-connection',
        ...(this.config.dataPath ? ['--config', this.config.dataPath] : []),
      ]);

      this.process.stdout?.on('data', (data) => {
        this.handleOutput(data.toString());
      });

      this.process.stderr?.on('data', (data) => {
        log.error(`Signal CLI error: ${data}`);
      });

      this.process.on('close', (code) => {
        log.warn(`Signal CLI process exited with code ${code}`);
        this.status.connected = false;
        this.scheduleReconnect();
      });

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 3000));

      this.status.connected = true;
      this.status.connecting = false;
      this.status.lastConnected = new Date();

      this.registerWithGateway();
      this.processMessageQueue();

      log.info('Signal connected successfully');
    } catch (error) {
      log.error('Failed to connect to Signal:', error);
      this.status.connecting = false;
      this.status.error = String(error);
      this.scheduleReconnect();
    }
  }

  private handleOutput(output: string): void {
    try {
      const lines = output.split('\n').filter((line) => line.trim());
      
      for (const line of lines) {
        if (line.startsWith('{')) {
          const data = JSON.parse(line);
          
          if (data.envelope) {
            this.handleEnvelope(data.envelope);
          }
        }
      }
    } catch (error) {
      log.debug('Signal output:', output);
    }
  }

  private handleEnvelope(envelope: any): void {
    const { source, sourceName, timestamp, dataMessage } = envelope;

    if (!dataMessage) return;

    const incomingMessage: IncomingMessage = {
      id: generateId(),
      channel: 'signal',
      channelId: this.id,
      senderId: source,
      senderName: sourceName || source,
      chatId: dataMessage.groupInfo?.groupId || source,
      chatType: dataMessage.groupInfo ? 'group' : 'direct',
      chatName: dataMessage.groupInfo?.name || sourceName || source,
      content: dataMessage.message || '',
      timestamp: new Date(timestamp),
      mentions: [],
      media: this.extractMedia(dataMessage),
      raw: envelope,
    };

    log.info(`Received Signal message from ${sourceName}: ${dataMessage.message?.substring(0, 50)}...`);

    getGateway().publish('messages', {
      type: 'message:received',
      timestamp: new Date(),
      source: `signal:${this.id}`,
      payload: incomingMessage,
    });
  }

  private extractMedia(dataMessage: any): MediaAttachment[] {
    const media: MediaAttachment[] = [];

    if (dataMessage.attachments) {
      for (const attachment of dataMessage.attachments) {
        media.push({
          type: attachment.contentType?.startsWith('image/') ? 'image' :
                attachment.contentType?.startsWith('video/') ? 'video' :
                attachment.contentType?.startsWith('audio/') ? 'audio' : 'document',
          mimeType: attachment.contentType,
          filename: attachment.filename,
        });
      }
    }

    return media;
  }

  public async sendMessage(message: OutgoingMessage): Promise<void> {
    if (!this.status.connected) {
      log.warn('Signal not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      const args = [
        'send',
        '--username', this.config.phoneNumber,
        '--message', message.content,
      ];

      if (message.chatId.includes('-')) {
        // Group message
        args.push('--group-id', message.chatId);
      } else {
        // Direct message
        args.push(message.chatId);
      }

      const process = spawn(this.config.signalCliPath, args);

      await new Promise((resolve, reject) => {
        process.on('close', (code) => {
          if (code === 0) {
            resolve(null);
          } else {
            reject(new Error(`signal-cli exited with code ${code}`));
          }
        });
      });

      log.info(`Sent Signal message to ${message.chatId}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      log.error('Error sending Signal message:', error);
      this.messageQueue.push(message);
    }
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;
    log.info(`Processing ${this.messageQueue.length} queued Signal messages`);

    while (this.messageQueue.length > 0 && this.status.connected) {
      const message = this.messageQueue.shift()!;
      await this.sendMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.processingQueue = false;
  }

  private scheduleReconnect(): void {
    if (this.status.retryCount >= 5) {
      log.error('Max reconnection attempts reached for Signal');
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, this.status.retryCount), 60000);
    this.status.retryCount++;

    log.info(`Scheduling Signal reconnect in ${delay}ms (attempt ${this.status.retryCount})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private registerWithGateway(): void {
    const channel: Channel = {
      id: this.id,
      type: 'signal',
      name: `Signal (${this.config.phoneNumber})`,
      enabled: true,
      config: this.config,
      status: this.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    getGateway().addChannel(channel);
  }

  public async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.status.connected = false;
    this.status.connecting = false;
    log.info('Signal disconnected');
  }

  public getStatus(): ChannelStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.connected;
  }
}

export default SignalChannel;
