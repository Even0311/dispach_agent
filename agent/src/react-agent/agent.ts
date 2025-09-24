import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockChat } from "@langchain/community/chat_models/bedrock";
import { StateGraph, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { RunnableConfig, Runnable } from "@langchain/core/runnables";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { electricianTools } from './tools/electrician-service-tool';
import { ELECTRICIAN_SYSTEM_PROMPT } from './prompts';
import { AgentState, AgentRequest, AgentResponse, AgentStep } from './types';

export class ElectricianReactAgent {
  private modelRunnable!: Runnable;
  private tools: any[];
  private toolNode: ToolNode;
  private workflow: any;
  private app: any;

  constructor() {
    this.tools = electricianTools;
    this.toolNode = new ToolNode(this.tools);
    this.initializeModel();
    this.buildWorkflow();
  }

  private initializeModel() {
    const bedrockClient = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION || 'ap-southeast-2',
    });

    let model: BedrockChat = new BedrockChat({
      model: process.env.PRIMARY_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      region: process.env.BEDROCK_AWS_REGION || 'ap-southeast-2'// Lower temperature for more consistent tool usage
    });

    // Bind tools to the model
    this.modelRunnable = model.bindTools(electricianTools);
  }

  private buildWorkflow() {
    // Define the agent state
    const agentState = {
      messages: {
        value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [] as BaseMessage[],
      },
      next: {
        value: (x: string, y: string) => y ?? x,
        default: () => "agent",
      },
    };
    type NodeType = typeof agentState;
    type EdgeType = any;
    // Create the StateGraph
    this.workflow = new StateGraph<NodeType, EdgeType>({ channels: agentState });

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
      const systemMessage = new HumanMessage({
        content: ELECTRICIAN_SYSTEM_PROMPT,
      });
      messages.unshift(systemMessage);
    }

    try {
      const response = await this.modelRunnable.invoke(messages, config);
      return { messages: [response] };
    } catch (error) {
      console.error("Error in agent node:", error);
      const errorMessage = new AIMessage({
        content: "I apologize, but I'm having trouble processing your request right now. Please try again or contact our office directly at +61-2-9876-5432.",
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
    if (lastMessage.additional_kwargs?.tool_calls?.length > 0) {
      return "tools";
    }

    return "end";
  }

  public async execute(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];
    const sessionId = request.session_id || `session_${Date.now()}`;

    try {
      // Initialize tracer for LangSmith
      const tracer = new LangChainTracer({
        projectName: process.env.LANGSMITH_PROJECT || "electrician-react-agent"
      });

      // Create initial state
      const initialState = {
        messages: [new HumanMessage({ content: request.query })],
        next: "agent",
        input: request.query,
        chat_history: [],
        intermediate_steps: [],
      };

      // Execute the workflow with tracing
      const config: RunnableConfig = {
        callbacks: [tracer],
        metadata: {
          session_id: sessionId,
          user_query: request.query,
        },
        tags: ["electrician-agent", "react"],
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
        result: "I apologize, but I encountered an error while processing your request. Please contact Sydney Professional Electricians directly at +61-2-9876-5432 for immediate assistance.",
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
    messages.forEach((message, index) => {
      const timestamp = new Date().toISOString();

      if (message.getType() === 'human') {
        steps.push({
          type: 'thought',
          content: message.content as string,
          timestamp,
        });
      } else if (message.getType() === 'ai') {
        // Check for tool calls
        const toolCalls = message.additional_kwargs?.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
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
        query: "Hello, I need information about your electrical services.",
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