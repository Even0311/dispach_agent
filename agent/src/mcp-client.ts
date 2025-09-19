import { CallSkeleton, Message } from "@dispatch-agent/types";

// HTTP MCP Client implementation
export class MCPSessionClient {
  private baseUrl: string;

  constructor(baseUrl: string = process.env.MCP_SESSION_URL || "http://localhost:3000") {
    this.baseUrl = baseUrl;
  }

  private async httpCall(method: string, path: string, body?: any): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`HTTP request failed: ${method} ${path}`, error);
      throw error;
    }
  }


  async sessionGet(callSid: string): Promise<CallSkeleton | null> {
    try {
      console.log(`[MCP] GET /session/${callSid}`);

      const result = await this.httpCall('GET', `/session/${callSid}`);
      return result;
    } catch (error: any) {
      if (error.message.includes('404')) {
        return null; // Session doesn't exist
      }
      console.error(`Error calling session.get: ${error}`);
      throw error;
    }
  }

  async sessionPatch(callSid: string, updates: Record<string, any>): Promise<CallSkeleton> {
    try {
      console.log(`[MCP] PATCH /session/${callSid}`, updates);

      const result = await this.httpCall('PATCH', `/session/${callSid}`, { updates });
      return result;
    } catch (error) {
      console.error(`Error calling session.patch: ${error}`);
      throw error;
    }
  }

  async sessionAppendMessages(callSid: string, messages: Message[]): Promise<boolean> {
    try {
      console.log(`[MCP] POST /session/${callSid}/messages`, messages);

      const result = await this.httpCall('POST', `/session/${callSid}/messages`, { messages });
      return result.success;
    } catch (error) {
      console.error(`Error calling session.append_messages: ${error}`);
      throw error;
    }
  }

  async sessionTouch(callSid: string): Promise<boolean> {
    try {
      console.log(`[MCP] POST /session/${callSid}/touch`);

      const result = await this.httpCall('POST', `/session/${callSid}/touch`);
      return result.success;
    } catch (error) {
      console.error(`Error calling session.touch: ${error}`);
      throw error;
    }
  }
}