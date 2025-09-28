import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { ChatGeneration, ChatResult } from "@langchain/core/outputs";

interface ClaudeAPIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ClaudeAPIRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeAPIMessage[];
  system?: string;
}

interface ClaudeAPIResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  id: string;
  model: string;
  role: 'assistant';
  stop_reason: string;
  stop_sequence: null;
  type: 'message';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class ClaudeAPIChat extends BaseChatModel {
  model: string;
  maxTokens: number;
  apiKey: string;

  constructor(fields: {
    model?: string;
    maxTokens?: number;
    apiKey?: string;
  } = {}) {
    super(fields);
    this.model = fields.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = fields.maxTokens || 4096;
    this.apiKey = fields.apiKey || process.env.ANTHROPIC_API_KEY || '';

    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Claude API access');
    }
  }

  _llmType(): string {
    return 'claude-api';
  }

  async _generate(
    messages: BaseMessage[],
    options?: any,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const { systemMessage, userMessages } = this.convertMessages(messages);

    const request: ClaudeAPIRequest = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: userMessages,
    };

    if (systemMessage) {
      request.system = systemMessage;
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result: ClaudeAPIResponse = await response.json();

      const generation: ChatGeneration = {
        text: result.content[0]?.text || '',
        message: new AIMessage({
          content: result.content[0]?.text || '',
          additional_kwargs: {
            id: result.id,
            model: result.model,
            usage: result.usage,
            stop_reason: result.stop_reason,
          },
        }),
      };

      return {
        generations: [generation],
        llmOutput: {
          tokenUsage: {
            promptTokens: result.usage?.input_tokens || 0,
            completionTokens: result.usage?.output_tokens || 0,
            totalTokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
          },
        },
      };
    } catch (error) {
      console.error('Error calling Claude API:', error);
      throw error;
    }
  }

  private convertMessages(messages: BaseMessage[]): {
    systemMessage?: string;
    userMessages: ClaudeAPIMessage[];
  } {
    let systemMessage: string | undefined;
    const userMessages: ClaudeAPIMessage[] = [];

    for (const message of messages) {
      if (message._getType() === 'system') {
        systemMessage = message.content as string;
      } else if (message._getType() === 'human') {
        userMessages.push({
          role: 'user',
          content: message.content as string,
        });
      } else if (message._getType() === 'ai') {
        userMessages.push({
          role: 'assistant',
          content: message.content as string,
        });
      }
    }

    return { systemMessage, userMessages };
  }

  // Method to bind tools (for compatibility with existing code)
  bindTools(tools: any[]): ClaudeAPIChat {
    // For now, return this instance as-is
    // Tool calling would require additional implementation
    console.warn('Tool binding not yet implemented for Claude API client');
    return this;
  }
}