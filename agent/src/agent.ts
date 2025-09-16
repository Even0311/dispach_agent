import { CallSkeleton, AssistRequest, Message } from "@dispatch-agent/types";

// MCP Session tools interface
interface MCPSessionTools {
  sessionGet: (callSid: string) => Promise<CallSkeleton | null>;
  sessionPatch: (callSid: string, updates: Record<string, any>) => Promise<CallSkeleton>;
  sessionAppendMessages: (callSid: string, messages: Message[]) => Promise<boolean>;
  sessionTouch: (callSid: string) => Promise<boolean>;
}

export class DispatchAgent {
  private mcpTools: MCPSessionTools;

  constructor(mcpTools: MCPSessionTools) {
    this.mcpTools = mcpTools;
  }

  // Step 1: Load session from MCP
  private async loadSession(callSid: string): Promise<CallSkeleton> {
    console.log(`Loading session for callSid: ${callSid}`);

    try {
      let session = await this.mcpTools.sessionGet(callSid);

      if (!session) {
        // Create a new session using the HTTP endpoint
        session = await this.createSession(callSid);
      }

      return session;
    } catch (error) {
      console.error("Error loading session:", error);
      throw error;
    }
  }

  // Helper method to create a new session
  private async createSession(callSid: string): Promise<CallSkeleton> {
    console.log(`Creating new session for callSid: ${callSid}`);

    try {
      const response = await fetch(`${process.env.MCP_SESSION_URL || "http://localhost:3000"}/session/${callSid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      return await response.json() as CallSkeleton;
    } catch (error) {
      console.error("Error creating session:", error);
      throw error;
    }
  }

  // Step 2: Echo intent detection (simplified)
  private async echoIntent(userInput: string): Promise<string> {
    console.log("Detecting intent from input:", userInput);

    // Simple intent detection based on keywords
    let intent = "general";

    if (userInput.toLowerCase().includes("book") || userInput.toLowerCase().includes("appointment")) {
      intent = "booking";
    } else if (userInput.toLowerCase().includes("cancel")) {
      intent = "cancel";
    } else if (userInput.toLowerCase().includes("info") || userInput.toLowerCase().includes("service")) {
      intent = "info";
    }

    console.log(`Detected intent: ${intent}`);
    return intent;
  }

  // Step 3: Update session with new message and intent
  private async updateSession(callSid: string, userInput: string, intent: string): Promise<void> {
    console.log("Updating session with new information");

    // Append user message to history
    const newMessage: Message = {
      speaker: "customer",
      message: userInput,
      startedAt: new Date().toISOString()
    };

    await this.mcpTools.sessionAppendMessages(callSid, [newMessage]);

    // Touch session to update last active
    await this.mcpTools.sessionTouch(callSid);
  }

  // Step 4: Generate reply based on intent and session
  private async reply(intent: string, userInput: string, callSid: string): Promise<string> {
    console.log("Generating reply based on intent and session");

    let reply = "Hello! How can I help you today?";

    if (intent === "booking") {
      reply = "I'd be happy to help you book an appointment. What service are you interested in?";
    } else if (intent === "cancel") {
      reply = "I can help you cancel your appointment. Let me look up your booking details.";
    } else if (intent === "info") {
      reply = "Here's information about our available services. What would you like to know more about?";
    } else {
      reply = `I received your message: "${userInput}". How can I assist you?`;
    }

    // Append assistant message to session
    const assistantMessage: Message = {
      speaker: "AI",
      message: reply,
      startedAt: new Date().toISOString()
    };

    await this.mcpTools.sessionAppendMessages(callSid, [assistantMessage]);

    return reply;
  }

  // Main method to process a request - implements the flow: loadSession → echoIntent → updateSession → reply
  async processRequest(request: AssistRequest): Promise<string> {
    console.log(`Processing request for callSid: ${request.callSid}`);

    try {
      // Step 1: Load session
      const session = await this.loadSession(request.callSid);

      // Step 2: Echo intent detection
      const intent = await this.echoIntent(request.text);

      // Step 3: Update session with user message
      await this.updateSession(request.callSid, request.text, intent);

      // Step 4: Generate and return reply
      const reply = await this.reply(intent, request.text, request.callSid);

      return reply;
    } catch (error) {
      console.error("Error processing request:", error);
      throw error;
    }
  }
}