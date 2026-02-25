/**
 * OpenClaw - OpenAI Provider
 * Integration with OpenAI API
 */

import OpenAI from 'openai';
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

export interface OpenAIProviderConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
}

export class OpenAIProvider implements Provider {
  public id = 'openai';
  public type = 'openai' as const;
  public name = 'OpenAI';
  public enabled = true;
  public config: OpenAIProviderConfig;
  public models: Model[];
  public status: ProviderStatus = { available: true, lastChecked: new Date() };

  private client: OpenAI;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      organization: config.organization,
      project: config.project,
    });
    this.models = this.getAvailableModels();
  }

  private getAvailableModels(): Model[] {
    return [
      {
        id: 'gpt-4o',
        provider: 'openai',
        name: 'GPT-4o',
        description: 'Most capable multimodal model',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.005,
          output: 0.015,
          currency: 'USD',
        },
        contextWindow: 128000,
        maxOutputTokens: 4096,
      },
      {
        id: 'gpt-4o-mini',
        provider: 'openai',
        name: 'GPT-4o Mini',
        description: 'Fast, affordable small model for focused tasks',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.00015,
          output: 0.0006,
          currency: 'USD',
        },
        contextWindow: 128000,
        maxOutputTokens: 4096,
      },
      {
        id: 'gpt-4-turbo',
        provider: 'openai',
        name: 'GPT-4 Turbo',
        description: 'High-intelligence model with improved instruction following',
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          streaming: true,
          json: true,
          systemPrompt: true,
        },
        pricing: {
          input: 0.01,
          output: 0.03,
          currency: 'USD',
        },
        contextWindow: 128000,
        maxOutputTokens: 4096,
      },
      {
        id: 'gpt-3.5-turbo',
        provider: 'openai',
        name: 'GPT-3.5 Turbo',
        description: 'Fast, cost-effective model for simple tasks',
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
        contextWindow: 16385,
        maxOutputTokens: 4096,
      },
      {
        id: 'o1-preview',
        provider: 'openai',
        name: 'o1 Preview',
        description: 'Reasoning model for complex problems',
        capabilities: {
          chat: true,
          vision: false,
          tools: false,
          streaming: false,
          json: true,
          systemPrompt: false,
        },
        pricing: {
          input: 0.015,
          output: 0.06,
          currency: 'USD',
        },
        contextWindow: 128000,
        maxOutputTokens: 32768,
      },
      {
        id: 'o1-mini',
        provider: 'openai',
        name: 'o1 Mini',
        description: 'Faster reasoning model',
        capabilities: {
          chat: true,
          vision: false,
          tools: false,
          streaming: false,
          json: true,
          systemPrompt: false,
        },
        pricing: {
          input: 0.003,
          output: 0.012,
          currency: 'USD',
        },
        contextWindow: 128000,
        maxOutputTokens: 65536,
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
    const model = options.model || 'gpt-4o';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    try {
      // Convert messages to OpenAI format
      const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      if (options.systemPrompt) {
        openaiMessages.push({
          role: 'system',
          content: options.systemPrompt,
        });
      }

      for (const msg of messages) {
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
      }

      const request: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model,
        messages: openaiMessages,
        temperature,
        max_tokens: maxTokens,
      };

      if (options.tools && options.tools.length > 0) {
        request.tools = options.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: this.convertParametersToSchema(tool.parameters),
              required: tool.parameters.filter((p) => p.required).map((p) => p.name),
            },
          },
        }));
      }

      log.debug(`Sending request to OpenAI ${model}`);

      const response = await this.client.chat.completions.create(request);

      const choice = response.choices[0];
      const message = choice.message;

      const toolCalls: ToolCall[] = [];
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          toolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments),
          });
        }
      }

      return {
        content: message.content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          input: response.usage?.prompt_tokens || 0,
          output: response.usage?.completion_tokens || 0,
        },
      };
    } catch (error: any) {
      log.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${error.message}`);
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
    const model = options.model || 'gpt-4o';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 4096;

    try {
      const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      if (options.systemPrompt) {
        openaiMessages.push({
          role: 'system',
          content: options.systemPrompt,
        });
      }

      for (const msg of messages) {
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
      }

      const request: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model,
        messages: openaiMessages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      };

      if (options.tools && options.tools.length > 0) {
        request.tools = options.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: this.convertParametersToSchema(tool.parameters),
              required: tool.parameters.filter((p) => p.required).map((p) => p.name),
            },
          },
        }));
      }

      const stream = await this.client.chat.completions.create(request);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          yield { type: 'content', data: delta.content };
        }

        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            if (toolCall.function?.name) {
              yield {
                type: 'tool_call',
                data: {
                  id: toolCall.id || '',
                  name: toolCall.function.name,
                  arguments: JSON.parse(toolCall.function.arguments || '{}'),
                },
              };
            }
          }
        }
      }
    } catch (error: any) {
      log.error('OpenAI streaming error:', error);
      throw new Error(`OpenAI streaming error: ${error.message}`);
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
      await this.client.models.list();
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

export default OpenAIProvider;
