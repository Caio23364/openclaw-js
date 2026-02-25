/**
 * OpenClaw - Google Provider
 * Integration with Google Gemini API
 */

import { GoogleGenerativeAI, GenerativeModel, Content, Part } from '@google/generative-ai';
import { log } from '../utils/logger.js';
import {
  Provider,
  ProviderConfig,
  ProviderStatus,
  Model,
  Message,
  Tool,
  ToolCall
} from '../types/index.js';

export interface GoogleProviderConfig extends ProviderConfig {
  apiKey: string;
}

export class GoogleProvider implements Provider {
  public id = 'google';
  public type = 'google' as const;
  public name = 'Google';
  public enabled = true;
  public config: GoogleProviderConfig;
  public models: Model[];
  public status: ProviderStatus = { available: true, lastChecked: new Date() };

  private genAI: GoogleGenerativeAI;

  constructor(config: GoogleProviderConfig) {
    this.config = config;
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.models = this.getAvailableModels();
  }

  private getAvailableModels(): Model[] {
    return [
      {
        id: 'gemini-1.5-pro',
        provider: 'google',
        name: 'Gemini 1.5 Pro',
        description: 'Most capable model for complex reasoning and coding',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.0035,
          output: 0.0105,
          currency: 'USD',
        },
        contextWindow: 2000000,
        maxOutputTokens: 8192,
      },
      {
        id: 'gemini-1.5-flash',
        provider: 'google',
        name: 'Gemini 1.5 Flash',
        description: 'Fast and efficient multimodal model',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.00035,
          output: 0.00105,
          currency: 'USD',
        },
        contextWindow: 1000000,
        maxOutputTokens: 8192,
      },
      {
        id: 'gemini-1.0-pro',
        provider: 'google',
        name: 'Gemini 1.0 Pro',
        description: 'Reliable model for everyday tasks',
        capabilities: {
          chat: true,
          vision: false,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.0005,
          output: 0.0015,
          currency: 'USD',
        },
        contextWindow: 32000,
        maxOutputTokens: 2048,
      },
    ];
  }

  public async chat(
    messages: Message[],
    options: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: Tool[];
      stream?: boolean;
    } = {}
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: { input: number; output: number } }> {
    const modelId = options.model || 'gemini-1.5-pro';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    try {
      const model = this.genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
        systemInstruction: options.systemPrompt,
      });

      // Convert messages to Gemini format
      const history: Content[] = [];
      for (let i = 0; i < messages.length - 1; i++) {
        const msg = messages[i];
        history.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      }

      const chat = model.startChat({ history });

      const lastMessage = messages[messages.length - 1];
      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response;

      // Extract usage if available
      const usage = response.usageMetadata;

      return {
        content: response.text(),
        usage: usage ? {
          input: usage.promptTokenCount || 0,
          output: usage.candidatesTokenCount || 0,
        } : undefined,
      };
    } catch (error: any) {
      log.error('Google API error:', error);
      throw new Error(`Google API error: ${error.message}`);
    }
  }

  public async *streamChat(
    messages: Message[],
    options: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: Tool[];
    } = {}
  ): AsyncGenerator<{ type: 'content' | 'tool_call'; data: string | ToolCall }> {
    const modelId = options.model || 'gemini-1.5-pro';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    try {
      const model = this.genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
        systemInstruction: options.systemPrompt,
      });

      // Convert messages to Gemini format
      const history: Content[] = [];
      for (let i = 0; i < messages.length - 1; i++) {
        const msg = messages[i];
        history.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      }

      const chat = model.startChat({ history });

      const lastMessage = messages[messages.length - 1];
      const result = await chat.sendMessageStream(lastMessage.content);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield { type: 'content', data: text };
        }
      }
    } catch (error: any) {
      log.error('Google streaming error:', error);
      throw new Error(`Google streaming error: ${error.message}`);
    }
  }

  public async checkAvailability(): Promise<boolean> {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      await model.generateContent('Hi');
      this.status.available = true;
      this.status.lastChecked = new Date();
      return true;
    } catch (error) {
      this.status.available = false;
      this.status.lastChecked = new Date();
      this.status.error = String(error);
      return false;
    }
  }
}

export default GoogleProvider;
