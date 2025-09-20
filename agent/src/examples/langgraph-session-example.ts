import { StateGraph, END } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import {
  SessionAgentState,
  SessionStateManager,
  createLangGraphSessionIntegration
} from "../services/langgraph-session-tools";

/**
 * Example: LangGraph workflow with MCP session management
 * Demonstrates the hybrid architecture: StateGraph nodes + LangGraph tools
 */

// LLM configuration
const llm = new ChatOpenAI({
  modelName: "gpt-4",
  temperature: 0.1
});

/**
 * Create the complete LangGraph workflow
 */
export function createSessionAgent() {
  // Initialize session integration
  const { stateManager, businessTools } = createLangGraphSessionIntegration({
    transport: 'http',
    serverUrl: process.env.MCP_SESSION_URL || 'http://localhost:3000'
  });

  // Create React agent with business tools
  const reactAgent = createReactAgent({
    llm,
    tools: Object.values(businessTools),
    stateModifier: `You are a helpful customer service agent for booking appointments.

Your goal is to help customers book services by:
1. Collecting their information (name, phone, address)
2. Understanding what service they need
3. Scheduling an appropriate time
4. Completing the booking

You have access to tools to:
- update_user_info: Collect and store customer details
- select_service: Choose from available services
- schedule_time: Set an appointment time
- complete_booking: Finalize the booking
- get_session_info: Check current booking status

Be friendly, efficient, and make sure to collect all necessary information before completing the booking.
Use the tools when you have the information needed.`
  });

  // Define the workflow graph
  const workflow = new StateGraph<SessionAgentState>({
    channels: {
      callSid: { default: () => "" },
      session: { default: () => undefined },
      newMessages: { default: () => [] },
      userInput: { default: () => undefined },
      agentResponse: { default: () => undefined },
      error: { default: () => undefined }
    }
  });

  // Add nodes
  workflow.addNode("load_session", async (state: SessionAgentState) => {
    console.log("Node: Loading session...");
    return await stateManager.loadSession(state);
  });

  workflow.addNode("add_user_input", async (state: SessionAgentState) => {
    if (state.userInput) {
      console.log("Node: Adding user input to messages...");
      return stateManager.addUserMessage(state, state.userInput);
    }
    return state;
  });

  workflow.addNode("agent", async (state: SessionAgentState) => {
    console.log("Node: Agent processing...");

    try {
      // Prepare context for the agent
      const context = {
        callSid: state.callSid,
        session: state.session,
        conversationHistory: state.session?.history || [],
        userInput: state.userInput
      };

      // Run the React agent
      const result = await reactAgent.invoke({
        messages: [{
          role: "human",
          content: `Customer says: "${state.userInput}"

Session context:
- Call ID: ${state.callSid}
- Services available: ${JSON.stringify(state.session?.services || [])}
- User info collected: ${JSON.stringify(state.session?.user.userInfo || {})}
- Selected service: ${JSON.stringify(state.session?.user.service || null)}
- Scheduled time: ${state.session?.user.serviceBookedTime || 'not set'}
- Booking status: ${state.session?.servicebooked ? 'COMPLETED' : 'in progress'}

Previous conversation:
${state.session?.history.slice(-3).map(h => `${h.speaker}: ${h.message}`).join('\n') || 'No previous messages'}

Respond to the customer and use appropriate tools if needed.`
        }]
      });

      const agentResponse = result.messages[result.messages.length - 1].content;

      return stateManager.addAgentMessage(state, agentResponse);

    } catch (error) {
      console.error("Agent processing error:", error);
      const errorResponse = "I apologize, I'm having technical difficulties. Let me try to help you in another way.";
      return stateManager.addAgentMessage(state, errorResponse);
    }
  });

  workflow.addNode("save_messages", async (state: SessionAgentState) => {
    console.log("Node: Saving messages...");
    return await stateManager.saveMessages(state);
  });

  // Add edges
  workflow.setEntryPoint("load_session");
  workflow.addEdge("load_session", "add_user_input");
  workflow.addEdge("add_user_input", "agent");
  workflow.addEdge("agent", "save_messages");
  workflow.addEdge("save_messages", END);

  return {
    graph: workflow.compile(),
    stateManager,
    businessTools
  };
}

/**
 * Example usage function
 */
export async function runSessionExample() {
  const { graph, stateManager } = createSessionAgent();

  try {
    // Example conversation
    const callSid = "example-call-" + Date.now();

    // First interaction
    console.log("=== First Interaction ===");
    let result = await graph.invoke({
      callSid,
      userInput: "Hi, I need to book an appointment for a haircut"
    });

    console.log("Agent:", result.agentResponse);

    // Second interaction
    console.log("\\n=== Second Interaction ===");
    result = await graph.invoke({
      callSid,
      userInput: "My name is John Doe and my phone is 555-0123"
    });

    console.log("Agent:", result.agentResponse);

    // Third interaction
    console.log("\\n=== Third Interaction ===");
    result = await graph.invoke({
      callSid,
      userInput: "I'd like to schedule it for tomorrow at 2 PM"
    });

    console.log("Agent:", result.agentResponse);

    console.log("\\n=== Final Session State ===");
    const finalSession = await stateManager.mcpClient.sessionGet(callSid);
    console.log(JSON.stringify(finalSession, null, 2));

  } catch (error) {
    console.error("Example run failed:", error);
  } finally {
    await stateManager.close();
  }
}

/**
 * Simple session management without LangGraph (for basic cases)
 */
export class SimpleSessionAgent {
  private stateManager: SessionStateManager;

  constructor(config?: any) {
    this.stateManager = new SessionStateManager(config);
  }

  async processMessage(callSid: string, userMessage: string): Promise<string> {
    try {
      // Load session
      let state: SessionAgentState = { callSid, newMessages: [] };
      state = await this.stateManager.loadSession(state);

      if (state.error) {
        return "I'm sorry, I'm having trouble accessing your session. Please try again.";
      }

      // Add user message
      state = this.stateManager.addUserMessage(state, userMessage);

      // Simple rule-based response (can be replaced with LLM)
      const response = this.generateResponse(state);

      // Add agent response
      state = this.stateManager.addAgentMessage(state, response);

      // Save messages
      await this.stateManager.saveMessages(state);

      return response;

    } catch (error) {
      console.error("Processing error:", error);
      return "I apologize for the technical difficulty. Please try again.";
    }
  }

  private generateResponse(state: SessionAgentState): string {
    // Simple rule-based responses for demonstration
    const userInput = state.userInput?.toLowerCase() || "";

    if (userInput.includes("hello") || userInput.includes("hi")) {
      return "Hello! I'm here to help you book an appointment. What service are you looking for?";
    }

    if (userInput.includes("book") || userInput.includes("appointment")) {
      return "I'd be happy to help you book an appointment. Could you please tell me your name and phone number?";
    }

    if (userInput.includes("name") && userInput.includes("phone")) {
      return "Thank you for providing your information. What service would you like to book?";
    }

    return "I understand you're interested in booking a service. Could you provide more details about what you need?";
  }

  async close(): Promise<void> {
    await this.stateManager.close();
  }
}

// Export for easy import
export default {
  createSessionAgent,
  runSessionExample,
  SimpleSessionAgent
};