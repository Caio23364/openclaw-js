/**
 * OpenClaw - Anthropic Provider
 * Integration with Anthropic Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import { log } from '../utils/logger.js';
import {
  Provider,
  ProviderConfig,
  ProviderStatus,
  Model,
  ModelCapabilities,
  ModelPricing,
  Message,
  Tool,
  ToolCall,
  ToolResult
} from '../types/index.js';

export interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export class AnthropicProvider implements Provider {
  public id = 'anthropic';
  public type = 'anthropic' as const;
  public name = 'Anthropic';
  public enabled = true;
  public config: AnthropicProviderConfig;
  public models: Model[];
  public status: ProviderStatus = { available: true, lastChecked: new Date() };

  private client: Anthropic;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.models = this.getAvailableModels();
  }

  private getAvailableModels(): Model[] {
    return [
      {
        id: 'claude-3-opus-20240229',
        provider: 'anthropic',
        name: 'Claude 3 Opus',
        description: 'Most powerful model for highly complex tasks',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.015,
          output: 0.075,
          currency: 'USD',
        },
        contextWindow: 200000,
        maxOutputTokens: 4096,
      },
      {
        id: 'claude-3-sonnet-20240229',
        provider: 'anthropic',
        name: 'Claude 3 Sonnet',
        description: 'Ideal balance of intelligence and speed for efficient tasks',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.003,
          output: 0.015,
          currency: 'USD',
        },
        contextWindow: 200000,
        maxOutputTokens: 4096,
      },
      {
        id: 'claude-3-haiku-20240307',
        provider: 'anthropic',
        name: 'Claude 3 Haiku',
        description: 'Fastest model for lightweight actions',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.00025,
          output: 0.00125,
          currency: 'USD',
        },
        contextWindow: 200000,
        maxOutputTokens: 4096,
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        name: 'Claude 3.5 Sonnet',
        description: 'Most intelligent model with enhanced capabilities',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.003,
          output: 0.015,
          currency: 'USD',
        },
        contextWindow: 200000,
        maxOutputTokens: 8192,
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
    const model = options.model || 'claude-3-opus-20240229';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    try {
      // Convert messages to Anthropic format
      const anthropicMessages = messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      const request: Anthropic.MessageCreateParams = {
        model,
        messages: anthropicMessages,
        temperature,
        max_tokens: maxTokens,
      };

      if (options.systemPrompt) {
        (request as any).system = options.systemPrompt;
      }

      if (options.tools && options.tools.length > 0) {
        request.tools = options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            type: 'object',
            properties: this.convertParametersToSchema(tool.parameters),
            required: tool.parameters.filter((p) => p.required).map((p) => p.name),
          },
        }));
      }

      log.debug(`Sending request to Anthropic ${model}`);

      const response = await this.client.messages.create(request);

      let content = '';
      const toolCalls: ToolCall[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, any>,
          });
        }
      }

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
      };
    } catch (error: any) {
      log.error('Anthropic API error:', error);
      throw new Error(`Anthropic API error: ${error.message}`);
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
    const model = options.model || 'claude-3-opus-20240229';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    try {
      const anthropicMessages = messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      const request: Anthropic.MessageCreateParams = {
        model,
        messages: anthropicMessages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      };

      if (options.systemPrompt) {
        (request as any).system = options.systemPrompt;
      }

      if (options.tools && options.tools.length > 0) {
        request.tools = options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            type: 'object',
            properties: this.convertParametersToSchema(tool.parameters),
            required: tool.parameters.filter((p) => p.required).map((p) => p.name),
          },
        }));
      }

      const stream = await this.client.messages.create(request);

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            yield { type: 'content', data: chunk.delta.text };
          }
        } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
          yield {
            type: 'tool_call',
            data: {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              arguments: chunk.content_block.input as Record<string, any>,
            },
          };
        }
      }
    } catch (error: any) {
      log.error('Anthropic streaming error:', error);
      throw new Error(`Anthropic streaming error: ${error.message}`);
    }
  }

  private convertParametersToSchema(parameters: Tool['parameters']): Record<string, any> {
    const properties: Record<string, any> = {};
    for (const param of parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
      };
      if (param.enum) {
        properties[param.name].enum = param.enum;
      }
    }
    return properties;
  }

  public async checkAvailability(): Promise<boolean> {
    try {
      // Simple check by listing models (or making a minimal request)
      await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      });
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

export default AnthropicProvider;
