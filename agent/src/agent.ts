import { CallSkeleton, AssistRequest, Message, AIReplyResponse } from "@dispatch-agent/types";
import { BedrockService, LLMResponse, ToolAction } from "./services/bedrock.service";
import { MCPSessionClient, MCPSessionClientConfig, createMCPSessionClient } from "./services/mcp-session-client";

export class DispatchAgent {
  private mcpClient: MCPSessionClient;
  private bedrock: BedrockService;

  constructor(mcpConfig?: Partial<MCPSessionClientConfig>) {
    this.mcpClient = createMCPSessionClient(mcpConfig);
    this.bedrock = new BedrockService();
  }

  // Load session from MCP server
  private async loadSession(callSid: string): Promise<CallSkeleton> {
    console.log(`Loading session for callSid: ${callSid}`);

    try {
      let session = await this.mcpClient.sessionGet(callSid);

      if (!session) {
        // Create a new session using MCP
        session = await this.mcpClient.sessionCreate(callSid);
      }

      return session;
    } catch (error) {
      console.error("Error loading session:", error);
      throw error;
    }
  }

  async processRequest(request: AssistRequest): Promise<AIReplyResponse> {
    console.log(`Processing request for callSid: ${request.callSid}`);

    try {
      const session = await this.loadSession(request.callSid);

      return {
        message: "Session loaded successfully",
        shouldHangup: false
      };
    } catch (error) {
      console.error("Error processing request:", error);

      // Fallback response
      return {
        message: "I apologize, but I'm experiencing technical difficulties. Please try again or contact support.",
        shouldHangup: false
      };
    }
  }

}