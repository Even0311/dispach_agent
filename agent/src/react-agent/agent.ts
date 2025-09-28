import { BedrockChat } from "@langchain/community/chat_models/bedrock";
import { ClaudeAPIChat } from '../chat-models/claude-api';
import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { RunnableConfig, Runnable } from "@langchain/core/runnables";
import { electricianTools } from './tools/electrician-service-tool';
import { GENERAL_SYSTEM_PROMPT } from './prompts';
import { AgentState, AgentRequest, AgentResponse, AgentStep } from './types';

export class GeneralServiceReactAgent {
  private modelRunnable!: Runnable;
  private tools: any[];
  private toolNode: ToolNode;
  private workflow: any;
  private app: any;

  constructor() {
    this.tools = electricianTools;
    this.toolNode = new ToolNode(this.tools);

    // Check LangSmith API key availability
    const langsmithApiKey = process.env.LANGSMITH_API_KEY;
    if (langsmithApiKey) {
      console.log(`LangSmith API key detected: ${langsmithApiKey.substring(0, 8)}...`);
    } else {
      console.log('LangSmith API key not found in environment variables');
    }

    this.initializeModel();
    this.buildWorkflow();
  }

  private initializeModel() {
    // Check if we should use Claude API or Bedrock
    const useClaudeAPI = process.env.USE_CLAUDE_API === 'true' || process.env.ANTHROPIC_API_KEY;

    let model: BedrockChat | ClaudeAPIChat;

    if (useClaudeAPI && process.env.ANTHROPIC_API_KEY) {
      console.log('Using Claude API directly');
      model = new ClaudeAPIChat({
        model: 'claude-3-5-sonnet-20241022',
        maxTokens: 4096,
        apiKey: process.env.ANTHROPIC_API_KEY
      });
    } else {
      console.log('Using Bedrock with model:', process.env.PRIMARY_MODEL);
      model = new BedrockChat({
        model: process.env.PRIMARY_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        region: process.env.BEDROCK_AWS_REGION || 'ap-southeast-2'
      });
    }

    // Bind tools to the model
    this.modelRunnable = model.bindTools(electricianTools);
  }

  private buildWorkflow() {
    // Define the agent state annotation using LangGraph v0.3 pattern
    const GraphAnnotation = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
      }),
      next: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "agent",
      }),
    });

    // Create the StateGraph
    this.workflow = new StateGraph(GraphAnnotation);

    // Define agent node
    this.workflow.addNode("agent", this.agentNode.bind(this));

    // Define tools node
    this.workflow.addNode("tools", this.toolNode);

    // Set entry point
    this.workflow.addEdge(START, "agent");

    // Define conditional edges
    this.workflow.addConditionalEdges(
      "agent",
      this.shouldContinue.bind(this),
      {
        tools: "tools",
        end: END,
      }
    );

    // Add edge from tools back to agent
    this.workflow.addEdge("tools", "agent");

    // Compile the workflow
    this.app = this.workflow.compile();
  }

  private async agentNode(state: AgentState, config?: RunnableConfig): Promise<any> {
    const messages = state.messages || [];

    // Add system message if it's the first message
    if (messages.length === 0 || !messages.some(m => m._getType() === 'system')) {
      const systemMessage = new SystemMessage({
        content: GENERAL_SYSTEM_PROMPT,
      });
      messages.unshift(systemMessage);
    }

    try {
      const response = await this.modelRunnable.invoke(messages, config);
      return { messages: [response] };
    } catch (error) {
      console.error("Error in agent node:", error);
      const errorMessage = new AIMessage({
        content: "I apologize, but I'm having trouble processing your request right now. Please try again or contact our office directly.",
      });
      return { messages: [errorMessage] };
    }
  }

  private shouldContinue(state: AgentState): "tools" | "end" {
    const messages = state.messages || [];
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return "end";
    }

    // Check if the last message has tool calls
    const aiMessage = lastMessage as any;
    if (aiMessage.tool_calls && Array.isArray(aiMessage.tool_calls) && aiMessage.tool_calls.length > 0) {
      return "tools";
    }

    return "end";
  }

  public async execute(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];
    const sessionId = request.session_id || `session_${Date.now()}`;

    try {
      // Create initial state
      const initialState = {
        messages: [new HumanMessage({ content: request.query })],
        next: "agent",
        input: request.query,
        chat_history: [],
        intermediate_steps: [],
      };

      // Execute the workflow with LangSmith auto-tracing
      const config: RunnableConfig = {
        metadata: {
          session_id: sessionId,
          user_query: request.query,
        },
        tags: ["general-service-agent", "react"],
      };

      const result = await this.app.invoke(initialState, config);

      // Extract final result
      const messages = result.messages || [];
      const lastMessage = messages[messages.length - 1];
      const finalResult = lastMessage?.content || "I apologize, but I couldn't process your request.";

      // Process steps for observability
      this.extractSteps(messages, steps);

      const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

      return {
        result: finalResult,
        steps,
        execution_time: `${executionTime}s`,
        session_id: sessionId,
      };

    } catch (error) {
      console.error("Error executing agent:", error);
      const err = error as Error;

      const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

      return {
        result: "I apologize, but I encountered an error while processing your request. Please contact our office directly for immediate assistance.",
        steps: [{
          type: 'final_answer',
          content: `Error: ${err.message}`,
          timestamp: new Date().toISOString(),
        }],
        execution_time: `${executionTime}s`,
        session_id: sessionId,
      };
    }
  }

  private extractSteps(messages: BaseMessage[], steps: AgentStep[]): void {
    messages.forEach((message) => {
      const timestamp = new Date().toISOString();

      if (message.getType() === 'human') {
        steps.push({
          type: 'thought',
          content: message.content as string,
          timestamp,
        });
      } else if (message.getType() === 'ai') {
        // Check for tool calls
        const aiMessage = message as any;
        const toolCalls = aiMessage.tool_calls;
        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
          toolCalls.forEach((toolCall: any) => {
            steps.push({
              type: 'action',
              content: `Using tool: ${toolCall.function.name}`,
              timestamp,
              tool_name: toolCall.function.name,
              tool_input: JSON.parse(toolCall.function.arguments),
            });
          });
        } else {
          steps.push({
            type: 'final_answer',
            content: message.content as string,
            timestamp,
          });
        }
      } else if (message.getType() === 'tool') {
        steps.push({
          type: 'observation',
          content: `Tool result: ${(message.content as string).substring(0, 200)}...`,
          timestamp,
          tool_output: message.content,
        });
      }
    });
  }

  // Method for testing the agent
  public async testConnection(): Promise<boolean> {
    try {
      const testResponse = await this.execute({
        query: "Hello, I need information about your services.",
        session_id: "test_session"
      });

      return testResponse.result.length > 0;
    } catch (error) {
      console.error("Connection test failed:", error);
      return false;
    }
  }

  // Method to get agent info
  public getAgentInfo(): any {
    return {
      model: process.env.PRIMARY_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      region: process.env.BEDROCK_REGION || 'ap-southeast-2',
      tools: this.tools.map(tool => ({
        name: tool.name,
        description: tool.description
      })),
      version: "1.0.0"
    };
  }
}