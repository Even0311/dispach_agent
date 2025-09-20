import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CallSkeleton, AIReplyResponse } from '@dispatch-agent/types';

export interface BedrockConfig {
  region: string;
  primaryModel: string;
  fastModel?: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMResponse {
  message: string;
  intent: string;
  actions: ToolAction[];
  shouldHangup?: boolean;
  confidence?: number;
}

export interface ToolAction {
  type: string;
  data: Record<string, any>;
}

export class BedrockService {
  private client: BedrockRuntimeClient;
  private config: BedrockConfig;

  constructor(config?: Partial<BedrockConfig>) {
    this.config = {
      region: process.env.BEDROCK_REGION || 'ap-southeast-2',
      primaryModel: process.env.PRIMARY_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      fastModel: process.env.FAST_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0',
      maxTokens: parseInt(process.env.MAX_TOKENS || '4096'),
      temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
      ...config
    };

    this.client = new BedrockRuntimeClient({
      region: this.config.region,
    });
  }

  /**
   * Generate a response using Claude model
   */
  async generateResponse(
    userInput: string,
    context: CallSkeleton,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    try {
      const prompt = this.buildPrompt(userInput, context, systemPrompt);

      console.log(`[BedrockService] Calling ${this.config.primaryModel} with prompt length: ${prompt.length}`);

      const response = await this.invokeModel(prompt, this.config.primaryModel);

      return this.parseResponse(response, userInput);
    } catch (error) {
      console.error('[BedrockService] Error generating response:', error);

      // Fallback response
      return {
        message: "I apologize, but I'm having trouble processing your request right now. Please try again or contact support.",
        intent: "general",
        actions: [],
        shouldHangup: false,
        confidence: 0
      };
    }
  }

  /**
   * Fast classification using Haiku model
   */
  async classifyIntent(userInput: string): Promise<{
    intent: string;
    confidence: number;
  }> {
    try {
      const classificationPrompt = this.buildClassificationPrompt(userInput);
      const response = await this.invokeModel(classificationPrompt, this.config.fastModel!);

      // Parse classification response
      const parsed = this.parseClassificationResponse(response);

      console.log(`[BedrockService] Intent classification: ${parsed.intent} (confidence: ${parsed.confidence})`);

      return parsed;
    } catch (error) {
      console.error('[BedrockService] Error classifying intent:', error);
      return {
        intent: "general",
        confidence: 0.5
      };
    }
  }

  /**
   * Build the conversation prompt for Claude
   */
  private buildPrompt(
    userInput: string,
    context: CallSkeleton,
    systemPrompt?: string
  ): string {
    const defaultSystemPrompt = `You are a professional customer service assistant for ${context.company.name}.

Your role:
- Help customers with service bookings and inquiries
- Collect necessary information for appointments
- Provide helpful and accurate information
- Maintain a friendly, professional tone

Available services:
${context.services.map(s => `- ${s.name}: ${s.description || 'No description'} (Price: ${s.price ? `$${s.price}` : 'Contact for pricing'})`).join('\n')}

Customer information collected so far:
${Object.entries(context.user.userInfo).map(([key, value]) => `- ${key}: ${value || 'Not provided'}`).join('\n')}

Conversation history:
${context.history.slice(-5).map(msg => `${msg.speaker}: ${msg.message}`).join('\n')}

Current booking status:
- Service selected: ${context.user.service?.name || 'None'}
- Booking time: ${context.user.serviceBookedTime || 'Not scheduled'}
- Service booked: ${context.servicebooked ? 'Yes' : 'No'}

Instructions:
1. Respond helpfully to the customer's message
2. If they want to book, guide them through the process
3. Collect: service preference, preferred time, contact information
4. Confirm details before completing booking
5. Only set shouldHangup to true if the customer explicitly wants to end the call

Respond with a JSON object in this exact format:
{
  "message": "Your helpful response to the customer",
  "intent": "booking|cancel|info|general|goodbye",
  "actions": [
    {
      "type": "update_user_info|select_service|schedule_time|complete_booking",
      "data": {"key": "value"}
    }
  ],
  "shouldHangup": false,
  "confidence": 0.95
}`;

    const prompt = `${systemPrompt || defaultSystemPrompt}

Customer just said: "${userInput}"

Please respond:`;

    return prompt;
  }

  /**
   * Build classification prompt for fast intent detection
   */
  private buildClassificationPrompt(userInput: string): string {
    return `Classify the customer's intent from their message. Respond with JSON only.

Customer message: "${userInput}"

Possible intents:
- booking: Want to make an appointment/reservation
- cancel: Want to cancel existing booking
- reschedule: Want to change existing booking time
- info: Asking for information about services/pricing
- complaint: Has an issue or complaint
- goodbye: Wants to end the conversation
- general: General conversation or unclear intent

Respond with:
{
  "intent": "one_of_the_above",
  "confidence": 0.0_to_1.0
}`;
  }

  /**
   * Invoke Claude model via Bedrock
   */
  private async invokeModel(prompt: string, modelId: string): Promise<string> {
    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    };

    const command = new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody)
    });

    const response = await this.client.send(command);

    if (!response.body) {
      throw new Error('No response body from Bedrock');
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.content || !responseBody.content[0]) {
      throw new Error('Invalid response format from Bedrock');
    }

    return responseBody.content[0].text;
  }

  /**
   * Parse the LLM response into structured format
   */
  private parseResponse(response: string, userInput: string): LLMResponse {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        // Fallback if no JSON found
        return {
          message: response.trim(),
          intent: "general",
          actions: [],
          shouldHangup: false,
          confidence: 0.7
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      return {
        message: parsed.message || response.trim(),
        intent: parsed.intent || "general",
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        shouldHangup: parsed.shouldHangup === true,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8
      };
    } catch (error) {
      console.error('[BedrockService] Error parsing response:', error);

      // Fallback parsing
      return {
        message: response.trim(),
        intent: this.inferIntentFromText(userInput),
        actions: [],
        shouldHangup: false,
        confidence: 0.5
      };
    }
  }

  /**
   * Parse classification response
   */
  private parseClassificationResponse(response: string): {
    intent: string;
    confidence: number;
  } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in classification response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        intent: parsed.intent || "general",
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
      };
    } catch (error) {
      console.error('[BedrockService] Error parsing classification:', error);
      return {
        intent: "general",
        confidence: 0.5
      };
    }
  }

  /**
   * Fallback intent detection using simple keywords
   */
  private inferIntentFromText(text: string): string {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('book') || lowerText.includes('appointment') || lowerText.includes('schedule')) {
      return 'booking';
    }
    if (lowerText.includes('cancel')) {
      return 'cancel';
    }
    if (lowerText.includes('info') || lowerText.includes('service') || lowerText.includes('price')) {
      return 'info';
    }
    if (lowerText.includes('bye') || lowerText.includes('goodbye') || lowerText.includes('thanks')) {
      return 'goodbye';
    }

    return 'general';
  }

  /**
   * Test the Bedrock connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const testResponse = await this.invokeModel(
        "Respond with just 'Hello, Bedrock is working!' and nothing else.",
        this.config.primaryModel
      );

      console.log('[BedrockService] Test response:', testResponse);
      return testResponse.includes('Hello') || testResponse.includes('working');
    } catch (error) {
      console.error('[BedrockService] Connection test failed:', error);
      return false;
    }
  }
}