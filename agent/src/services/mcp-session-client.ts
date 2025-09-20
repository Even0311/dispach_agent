import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallSkeleton, Message } from "@dispatch-agent/types";
import {
  CallToolResult,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';

export interface MCPSessionClientConfig {
  transport: 'http' | 'stdio';
  serverUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  authToken?: string;
}

/**
 * MCP Session Client - follows the correct MCP client pattern
 * Based on learning from mcp-project examples
 */
export class MCPSessionClient {
  private client: Client;
  private config: Required<MCPSessionClientConfig>;
  private transport: StreamableHTTPClientTransport | StdioClientTransport | null = null;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(config: MCPSessionClientConfig = { transport: 'http' }) {
    this.config = {
      transport: config.transport,
      serverUrl: config.serverUrl || process.env.MCP_SESSION_URL || 'http://localhost:3000/mcp',
      maxRetries: config.maxRetries || 3,
      timeoutMs: config.timeoutMs || 30000,
      retryDelayMs: config.retryDelayMs || 1000,
      authToken: config.authToken || 'Bearer 1234567890'
    };

    this.client = new Client({
      name: 'dispatch-agent-client',
      version: '0.1.0'
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.connect();
    await this.connectionPromise;
  }

  private async connect(): Promise<void> {
    try {
      if (this.config.transport === 'stdio') {
        this.transport = new StdioClientTransport({
          command: 'npx',
          args: ['tsx', 'mcp/session/src/server.ts'],
        });

        await this.client.connect(this.transport);
        console.log('Connected to MCP server via stdio transport');

      } else {
        const url = new URL(this.config.serverUrl);

        this.transport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: {
              'x-api-key': this.config.authToken,
            },
          },
        });

        await this.client.connect(this.transport, {
          timeout: this.config.timeoutMs,
        });

        console.log(
          `Connected to MCP server via httpStream transport; transport session id: ${this.transport.sessionId}`
        );
      }

      this.setupTransport();
      this.isConnected = true;

    } catch (error) {
      this.connectionPromise = null;
      console.error('Failed to connect to MCP server:', error);
      throw new Error(`MCP connection failed: ${error}`);
    }
  }

  private setupTransport() {
    if (!this.transport) {
      return;
    }

    this.transport.onclose = () => {
      console.log('MCP transport closed');
      this.isConnected = false;
      this.connectionPromise = null;
    };

    this.transport.onerror = async (error) => {
      console.error('MCP transport error:', error);
      await this.disconnect();
    };

    // 🚨 Important: Do NOT set onmessage as it interferes with request-response
    // this.transport.onmessage = (message) => { ... };
  }

  private async disconnect(): Promise<void> {
    if (this.isConnected && this.client) {
      await this.client.close();
      this.isConnected = false;
      this.connectionPromise = null;
      this.transport = null;
    }
  }

  private async callToolWithRetry<T>(
    toolName: string,
    args: Record<string, any>,
    parser: (result: CallToolResult) => T
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.ensureConnected();

        const result = await Promise.race([
          this.client.callTool({
            name: toolName,
            arguments: args
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), this.config.timeoutMs)
          )
        ]);

        return parser(result);

      } catch (error) {
        lastError = error as Error;
        console.warn(`MCP call attempt ${attempt}/${this.config.maxRetries} failed:`, error);

        // If it's the last attempt, don't retry
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Reset connection on certain errors
        if (this.shouldResetConnection(error)) {
          await this.disconnect();
        }

        // Wait before retrying with exponential backoff
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`MCP call failed after ${this.config.maxRetries} attempts: ${lastError?.message}`);
  }

  private shouldResetConnection(error: any): boolean {
    // Reset connection on network errors, timeouts, or connection issues
    const message = error?.message?.toLowerCase() || '';
    return message.includes('timeout') ||
           message.includes('connection') ||
           message.includes('network') ||
           message.includes('econnreset') ||
           message.includes('enotfound');
  }

  private parseSessionResult(result: CallToolResult): CallSkeleton | null {
    if (!result.content || result.content.length === 0) {
      throw new Error('No content in MCP response');
    }

    const content = result.content[0] as TextContent;
    if (content.type !== 'text') {
      throw new Error('Expected text content in MCP response');
    }

    const data = JSON.parse(content.text);

    if (data.error) {
      if (data.error === 'Session not found') {
        return null;
      }
      throw new Error(data.error);
    }

    return data as CallSkeleton;
  }

  private parseSuccessResult(result: CallToolResult): boolean {
    if (!result.content || result.content.length === 0) {
      throw new Error('No content in MCP response');
    }

    const content = result.content[0] as TextContent;
    if (content.type !== 'text') {
      throw new Error('Expected text content in MCP response');
    }

    const data = JSON.parse(content.text);

    if (data.error) {
      throw new Error(data.error);
    }

    return data.success === true;
  }

  // Public API methods - Session Management Tools
  async sessionGet(callSid: string): Promise<CallSkeleton | null> {
    if (!callSid || typeof callSid !== 'string') {
      throw new Error('callSid is required and must be a string');
    }

    return this.callToolWithRetry(
      'session.get',
      { callSid },
      this.parseSessionResult.bind(this)
    );
  }

  async sessionCreate(callSid: string): Promise<CallSkeleton> {
    if (!callSid || typeof callSid !== 'string') {
      throw new Error('callSid is required and must be a string');
    }

    const result = await this.callToolWithRetry(
      'session.create',
      { callSid },
      this.parseSessionResult.bind(this)
    );

    if (!result) {
      throw new Error('Failed to create session');
    }

    return result;
  }

  async sessionPatch(callSid: string, updates: Record<string, any>): Promise<CallSkeleton> {
    if (!callSid || typeof callSid !== 'string') {
      throw new Error('callSid is required and must be a string');
    }
    if (!updates || typeof updates !== 'object') {
      throw new Error('updates is required and must be an object');
    }

    const result = await this.callToolWithRetry(
      'session.patch',
      { callSid, updates },
      this.parseSessionResult.bind(this)
    );

    if (!result) {
      throw new Error('Failed to patch session');
    }

    return result;
  }

  async sessionAppendMessages(callSid: string, messages: Message[]): Promise<boolean> {
    if (!callSid || typeof callSid !== 'string') {
      throw new Error('callSid is required and must be a string');
    }
    if (!Array.isArray(messages)) {
      throw new Error('messages must be an array');
    }

    // Validate messages
    for (const message of messages) {
      if (!message.speaker || !message.message || !message.startedAt) {
        throw new Error('Each message must have speaker, message, and startedAt fields');
      }
    }

    return this.callToolWithRetry(
      'session.append_messages',
      { callSid, messages },
      this.parseSuccessResult.bind(this)
    );
  }

  async sessionTouch(callSid: string): Promise<boolean> {
    if (!callSid || typeof callSid !== 'string') {
      throw new Error('callSid is required and must be a string');
    }

    return this.callToolWithRetry(
      'session.touch',
      { callSid },
      this.parseSuccessResult.bind(this)
    );
  }

  // Utility methods
  async listTools(): Promise<any> {
    await this.ensureConnected();
    return this.client.listTools();
  }

  async close(): Promise<void> {
    await this.disconnect();
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.listTools();
      return true;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }

  // Get transport session ID (useful for debugging)
  get sessionId(): string | undefined {
    if (this.transport && 'sessionId' in this.transport) {
      return this.transport.sessionId;
    }
    return undefined;
  }
}

// Factory function for different environments
export function createMCPSessionClient(config?: Partial<MCPSessionClientConfig>): MCPSessionClient {
  // Auto-detect environment
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const defaultTransport = isLambda ? 'http' : 'http'; // Always use HTTP for now

  return new MCPSessionClient({
    transport: defaultTransport,
    ...config
  });
}