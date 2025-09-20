import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { CallSkeleton, Message } from "@dispatch-agent/types";
import { MCPSessionClient, createMCPSessionClient, MCPSessionClientConfig } from "./mcp-session-client";

/**
 * LangGraph State interface for session management
 */
export interface SessionAgentState {
  callSid: string;
  session?: CallSkeleton;
  newMessages: Message[];
  userInput?: string;
  agentResponse?: string;
  error?: string;
}

/**
 * Session Manager for StateGraph nodes
 * Handles reliable session lifecycle management
 */
export class SessionStateManager {
  private mcpClient: MCPSessionClient;

  constructor(config?: Partial<MCPSessionClientConfig>) {
    this.mcpClient = createMCPSessionClient(config);
  }

  /**
   * StateGraph node: Load session with auto-creation
   */
  async loadSession(state: SessionAgentState): Promise<SessionAgentState> {
    try {
      console.log(`Loading session for callSid: ${state.callSid}`);

      let session = await this.mcpClient.sessionGet(state.callSid);

      if (!session) {
        console.log(`Creating new session for callSid: ${state.callSid}`);
        session = await this.mcpClient.sessionCreate(state.callSid);
      }

      return {
        ...state,
        session,
        error: undefined
      };

    } catch (error) {
      console.error('Failed to load session:', error);
      return {
        ...state,
        error: `Session load failed: ${error}`
      };
    }
  }

  /**
   * StateGraph node: Save conversation history
   */
  async saveMessages(state: SessionAgentState): Promise<SessionAgentState> {
    try {
      if (state.newMessages && state.newMessages.length > 0) {
        const success = await this.mcpClient.sessionAppendMessages(
          state.callSid,
          state.newMessages
        );

        if (!success) {
          throw new Error('Failed to save messages');
        }

        // Touch session to update last active time
        await this.mcpClient.sessionTouch(state.callSid);

        console.log(`Saved ${state.newMessages.length} messages for ${state.callSid}`);
      }

      return {
        ...state,
        newMessages: [], // Clear after saving
        error: undefined
      };

    } catch (error) {
      console.error('Failed to save messages:', error);
      return {
        ...state,
        error: `Message save failed: ${error}`
      };
    }
  }

  /**
   * Add user input to new messages
   */
  addUserMessage(state: SessionAgentState, message: string): SessionAgentState {
    const userMessage: Message = {
      speaker: 'customer',
      message,
      startedAt: new Date().toISOString()
    };

    return {
      ...state,
      userInput: message,
      newMessages: [...(state.newMessages || []), userMessage]
    };
  }

  /**
   * Add agent response to new messages
   */
  addAgentMessage(state: SessionAgentState, message: string): SessionAgentState {
    const agentMessage: Message = {
      speaker: 'AI',
      message,
      startedAt: new Date().toISOString()
    };

    return {
      ...state,
      agentResponse: message,
      newMessages: [...(state.newMessages || []), agentMessage]
    };
  }

  async close(): Promise<void> {
    await this.mcpClient.close();
  }
}

/**
 * Business operation tools for LangGraph agent
 * These allow the LLM to make intelligent decisions about session updates
 */
export function createSessionBusinessTools(mcpClient?: MCPSessionClient) {
  const client = mcpClient || createMCPSessionClient();

  return {
    updateUserInfo: tool(
      async ({ callSid, userInfo }: { callSid: string; userInfo: Record<string, any> }) => {
        try {
          const session = await client.sessionPatch(callSid, {
            'user.userInfo': userInfo
          });

          return {
            success: true,
            message: `Updated user info: ${Object.keys(userInfo).join(', ')}`,
            userInfo: session.user.userInfo
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to update user info: ${error}`
          };
        }
      },
      {
        name: "update_user_info",
        description: "Update customer information (name, phone, address, etc.)",
        schema: z.object({
          callSid: z.string().describe("The call session ID"),
          userInfo: z.record(z.any()).describe("User information to update (name, phone, address, etc.)")
        })
      }
    ),

    selectService: tool(
      async ({ callSid, serviceId }: { callSid: string; serviceId: string }) => {
        try {
          // First get current session to find the service
          const currentSession = await client.sessionGet(callSid);
          if (!currentSession) {
            throw new Error('Session not found');
          }

          const service = currentSession.services.find(s => s.id === serviceId);
          if (!service) {
            throw new Error(`Service not found: ${serviceId}`);
          }

          const session = await client.sessionPatch(callSid, {
            'user.service': service
          });

          return {
            success: true,
            message: `Selected service: ${service.name}`,
            service: session.user.service
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to select service: ${error}`
          };
        }
      },
      {
        name: "select_service",
        description: "Select a service for booking from available services",
        schema: z.object({
          callSid: z.string().describe("The call session ID"),
          serviceId: z.string().describe("The ID of the service to select")
        })
      }
    ),

    scheduleTime: tool(
      async ({ callSid, scheduledTime }: { callSid: string; scheduledTime: string }) => {
        try {
          const session = await client.sessionPatch(callSid, {
            'user.serviceBookedTime': scheduledTime
          });

          return {
            success: true,
            message: `Scheduled for: ${scheduledTime}`,
            scheduledTime: session.user.serviceBookedTime
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to schedule time: ${error}`
          };
        }
      },
      {
        name: "schedule_time",
        description: "Schedule a time for the selected service",
        schema: z.object({
          callSid: z.string().describe("The call session ID"),
          scheduledTime: z.string().describe("The scheduled time (ISO string or human readable)")
        })
      }
    ),

    completeBooking: tool(
      async ({ callSid }: { callSid: string }) => {
        try {
          const session = await client.sessionPatch(callSid, {
            'servicebooked': true
          });

          return {
            success: true,
            message: "Booking completed successfully!",
            booking: {
              service: session.user.service,
              scheduledTime: session.user.serviceBookedTime,
              userInfo: session.user.userInfo
            }
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to complete booking: ${error}`
          };
        }
      },
      {
        name: "complete_booking",
        description: "Complete the booking process and mark service as booked",
        schema: z.object({
          callSid: z.string().describe("The call session ID")
        })
      }
    ),

    getSessionInfo: tool(
      async ({ callSid }: { callSid: string }) => {
        try {
          const session = await client.sessionGet(callSid);
          if (!session) {
            throw new Error('Session not found');
          }

          return {
            success: true,
            session: {
              callSid: session.callSid,
              services: session.services,
              userInfo: session.user.userInfo,
              selectedService: session.user.service,
              scheduledTime: session.user.serviceBookedTime,
              isBooked: session.servicebooked,
              messageCount: session.history.length
            }
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to get session info: ${error}`
          };
        }
      },
      {
        name: "get_session_info",
        description: "Get current session information and booking status",
        schema: z.object({
          callSid: z.string().describe("The call session ID")
        })
      }
    )
  };
}

/**
 * Factory function to create all LangGraph session components
 */
export function createLangGraphSessionIntegration(config?: Partial<MCPSessionClientConfig>) {
  const stateManager = new SessionStateManager(config);
  const businessTools = createSessionBusinessTools();

  return {
    stateManager,
    businessTools,

    // Helper to get all tools as array
    getToolsArray: () => Object.values(businessTools),

    // Helper to close all connections
    close: async () => {
      await stateManager.close();
      // Business tools share the same client created by factory
    }
  };
}