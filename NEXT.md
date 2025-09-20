# 🚀 Dispatch Agent - 完整LLM系统构建计划

将当前的简单关键词匹配agent升级为完整的LLM驱动的智能助手，支持Bedrock、MCP工具生态、RAG系统集成。

## 📋 当前状态评估

### ✅ 已完成
- **基础架构**: VPC + Redis + ECS + Lambda + API Gateway
- **MCP框架**: Session Server + HTTP Client
- **数据存储**: DynamoDB 7表 + Redis会话
- **对话框架**: LangGraph基础结构
- **类型系统**: 完整的TypeScript类型定义

### ❌ 待实现
- **LLM集成**: 无真实LLM，仅关键词匹配
- **MCP工具**: 只有基础会话管理，无数据库工具
- **RAG系统**: 无知识库和检索能力
- **业务逻辑**: 无真实预订、邮件、日历功能

---

## 🎯 三阶段建设计划

## 阶段一：LLM核心集成 (2-3周)
> **目标**: 用Bedrock替换关键词匹配，实现真正的AI对话

### 1.1 Bedrock LLM集成

#### 技术选型
```typescript
// Recommended models
- Claude 3.5 Sonnet (anthropic.claude-3-5-sonnet-v2)  // Primary conversation model
- Claude 3 Haiku (anthropic.claude-3-haiku)          // Fast response/classification tasks
- Titan Embeddings (amazon.titan-embed-text-v1)      // For RAG preparation
```

#### 代码改造
```typescript
// agent/src/services/bedrock.service.ts
export class BedrockService {
  async generateResponse(
    prompt: string,
    context: CallSkeleton,
    systemInstructions: string
  ): Promise<{
    message: string;
    intent: string;
    actions: Action[];
    shouldHangup?: boolean;
  }>
}

// agent/src/agent.ts - Refactored
export class DispatchAgent {
  private bedrock: BedrockService;

  // Replace echoIntent + reply with single LLM call
  private async processWithLLM(
    userInput: string,
    session: CallSkeleton
  ): Promise<{
    reply: string;
    intent: string;
    actions: Action[];
  }>
}
```

#### Prompt Engineering
```typescript
// agent/src/prompts/system-prompt.ts
export const SYSTEM_PROMPT = `
You are a professional customer service assistant responsible for handling customer service bookings.

Current conversation context:
- Company: {company.name}
- Available services: {services}
- Customer info: {userInfo}
- Conversation history: {history}

Your tasks:
1. Understand customer needs and provide assistance
2. Collect necessary booking information
3. Confirm service details and timing
4. Complete the booking process

Response format (JSON):
{
  "message": "Reply message to customer",
  "intent": "booking|cancel|info|general|complete",
  "actions": [
    {
      "type": "update_user_info",
      "data": {"name": "Customer Name"}
    }
  ],
  "shouldHangup": false
}
`;
```

### 1.2 会话上下文管理

#### 增强CallSkeleton
```typescript
// types/src/index.ts
export interface CallSkeleton {
  // ... existing fields

  // New LLM-related fields
  llmContext: {
    conversationSummary: string;      // Conversation summary
    currentIntent: string;            // Current intent
    collectedInfo: Record<string, any>; // Collected information
    nextAction: string;               // Next action
    confidenceScore: number;          // Confidence score
  };

  // Enhanced message history
  history: EnhancedMessage[];
}

export interface EnhancedMessage extends Message {
  intent?: string;
  confidence?: number;
  extractedData?: Record<string, any>;
  toolCalls?: ToolCall[];
}
```

#### 上下文窗口管理
```typescript
// agent/src/services/context.service.ts
export class ContextService {
  // Intelligently compress conversation history, keeping important information
  async compressHistory(history: EnhancedMessage[]): Promise<{
    compressedHistory: EnhancedMessage[];
    summary: string;
  }>

  // Build LLM input prompt
  async buildPrompt(
    session: CallSkeleton,
    userInput: string
  ): Promise<string>
}
```

### 1.3 CDK基础设施更新

#### Bedrock权限
```typescript
// infra/lib/dispatch-agent-stack.ts
const assistLambda = new lambda.Function(this, 'AssistLambda', {
  // ... existing configuration

  // Add Bedrock permissions
  initialPolicy: [
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-*`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-*`,
      ],
    }),
  ],

  environment: {
    // ... existing environment variables
    BEDROCK_REGION: this.region,
    PRIMARY_MODEL: 'anthropic.claude-3-5-sonnet-v2',
    FAST_MODEL: 'anthropic.claude-3-haiku',
    MAX_TOKENS: '4096',
    TEMPERATURE: '0.7',
  },
});
```

### 1.4 测试和验证
```typescript
// Test cases
const testCases = [
  {
    input: "I want to book a massage service",
    expected_intent: "booking",
    expected_actions: ["collect_service_preference"]
  },
  {
    input: "I want to cancel tomorrow's appointment",
    expected_intent: "cancel",
    expected_actions: ["lookup_existing_booking"]
  }
];
```

---

## 阶段二：MCP工具生态建设 (3-4周)
> **目标**: 让LLM能够通过MCP工具CRUD数据库，实现复杂业务操作

### 2.1 数据库访问工具

#### DynamoDB MCP工具集
```typescript
// mcp/session/src/tools/database.tools.ts
export class DatabaseTools {
  // User management tools
  @mcpTool("get_user_by_phone")
  async getUserByPhone(phoneNumber: string): Promise<User | null>

  @mcpTool("create_user")
  async createUser(userData: Partial<User>): Promise<User>

  @mcpTool("update_user")
  async updateUser(userId: string, updates: Partial<User>): Promise<User>

  // Service management tools
  @mcpTool("list_services")
  async listServices(companyId: string): Promise<Service[]>

  @mcpTool("get_service_details")
  async getServiceDetails(serviceId: string): Promise<Service>

  // Booking management tools
  @mcpTool("create_booking")
  async createBooking(bookingData: {
    callSid: string;
    userId: string;
    serviceId: string;
    scheduledTime: string;
    customerInfo: UserInfo;
  }): Promise<ServiceBooking>

  @mcpTool("check_availability")
  async checkAvailability(
    serviceId: string,
    date: string,
    timeSlots: string[]
  ): Promise<{
    available: boolean;
    suggestions: string[];
  }>

  @mcpTool("cancel_booking")
  async cancelBooking(bookingId: string): Promise<boolean>
}
```

#### 会话管理增强工具
```typescript
// mcp/session/src/tools/session.tools.ts
export class SessionTools {
  @mcpTool("get_conversation_summary")
  async getConversationSummary(callSid: string): Promise<string>

  @mcpTool("extract_customer_info")
  async extractCustomerInfo(callSid: string): Promise<{
    name?: string;
    phone?: string;
    email?: string;
    preferences?: string[];
  }>

  @mcpTool("update_conversation_state")
  async updateConversationState(
    callSid: string,
    state: {
      intent: string;
      collectedInfo: Record<string, any>;
      nextStep: string;
    }
  ): Promise<void>

  @mcpTool("add_conversation_note")
  async addConversationNote(
    callSid: string,
    note: string,
    type: 'system' | 'agent' | 'customer'
  ): Promise<void>
}
```

### 2.2 LLM Agent工具调用集成

#### 工具调用框架
```typescript
// agent/src/services/tool-executor.service.ts
export class ToolExecutorService {
  constructor(private mcpClient: MCPSessionClient) {}

  async executeTool(
    toolName: string,
    parameters: Record<string, any>
  ): Promise<any> {
    return await this.mcpClient.callTool(toolName, parameters);
  }

  async executeToolChain(tools: ToolCall[]): Promise<ToolResult[]> {
    const results = [];
    for (const tool of tools) {
      const result = await this.executeTool(tool.name, tool.parameters);
      results.push({ tool: tool.name, result });
    }
    return results;
  }
}
```

#### Agent工具集成
```typescript
// agent/src/agent.ts - 增强版本
export class DispatchAgent {
  private toolExecutor: ToolExecutorService;

  async processRequest(request: AssistRequest): Promise<string> {
    // 1. 加载会话
    const session = await this.loadSession(request.callSid);

    // 2. LLM处理 + 工具调用
    const llmResponse = await this.bedrock.generateResponse(
      request.text,
      session,
      this.buildSystemPrompt(session)
    );

    // 3. 执行工具调用
    if (llmResponse.actions.length > 0) {
      const toolResults = await this.toolExecutor.executeToolChain(
        llmResponse.actions
      );

      // 4. 根据工具结果更新回复
      llmResponse.message = await this.incorporateToolResults(
        llmResponse.message,
        toolResults
      );
    }

    // 5. 更新会话
    await this.updateSessionWithLLMResponse(request.callSid, llmResponse);

    return llmResponse.message;
  }
}
```

### 2.3 智能路由和多步骤流程

#### 对话状态机
```typescript
// agent/src/state-machine/booking-flow.ts
export enum BookingState {
  INITIAL = 'initial',
  SERVICE_SELECTION = 'service_selection',
  TIME_SELECTION = 'time_selection',
  INFO_COLLECTION = 'info_collection',
  CONFIRMATION = 'confirmation',
  COMPLETED = 'completed'
}

export class BookingFlowManager {
  async getNextAction(
    currentState: BookingState,
    collectedInfo: Record<string, any>,
    availableServices: Service[]
  ): Promise<{
    nextState: BookingState;
    requiredInfo: string[];
    suggestedActions: string[];
  }>
}
```

### 2.4 增强MCP Server

#### 工具注册和发现
```typescript
// mcp/session/src/index.ts - 增强版本
class MCPSessionServer {
  private tools: Map<string, MCPTool> = new Map();

  async registerTools() {
    // 注册数据库工具
    const dbTools = new DatabaseTools(this.dynamoService);
    const sessionTools = new SessionTools(this.sessionRepo);

    // 自动发现和注册工具
    this.registerToolClass(dbTools);
    this.registerToolClass(sessionTools);
  }

  async handleToolCall(toolName: string, parameters: any) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    return await tool.execute(parameters);
  }
}
```

---

## 阶段三：RAG系统和高级功能 (4-5周)
> **目标**: 集成知识库检索、复杂业务逻辑、外部系统集成

### 3.1 RAG知识库系统

#### Vector Database集成
```typescript
// 选择：OpenSearch + Titan Embeddings
// infra/lib/dispatch-agent-stack.ts
const opensearchDomain = new opensearch.Domain(this, 'KnowledgeBase', {
  version: opensearch.EngineVersion.OPENSEARCH_2_5,
  capacity: {
    dataNodes: 2,
    dataNodeInstanceType: 't3.small.search',
  },
  ebs: {
    volumeSize: 20,
    volumeType: ec2.EbsDeviceVolumeType.GP3,
  },
  zoneAwareness: {
    enabled: true,
    availabilityZoneCount: 2,
  },
});
```

#### 知识库管理
```typescript
// agent/src/services/knowledge.service.ts
export class KnowledgeService {
  async searchKnowledge(
    query: string,
    context: CallSkeleton,
    limit: number = 5
  ): Promise<KnowledgeResult[]> {
    // 1. 生成查询嵌入
    const queryEmbedding = await this.generateEmbedding(query);

    // 2. 向量搜索
    const searchResults = await this.opensearch.search({
      index: 'knowledge-base',
      body: {
        query: {
          knn: {
            content_vector: {
              vector: queryEmbedding,
              k: limit,
            },
          },
        },
        _source: ['title', 'content', 'category', 'relevance_score'],
      },
    });

    // 3. 重排序和过滤
    return this.rankAndFilter(searchResults, context);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return await this.bedrock.invokeModel({
      modelId: 'amazon.titan-embed-text-v1',
      body: JSON.stringify({
        inputText: text,
      }),
    });
  }
}
```

#### RAG增强的Agent
```typescript
// agent/src/agent.ts - RAG增强版本
export class DispatchAgent {
  private knowledge: KnowledgeService;

  async processWithRAG(
    userInput: string,
    session: CallSkeleton
  ): Promise<string> {
    // 1. 检索相关知识
    const knowledgeResults = await this.knowledge.searchKnowledge(
      userInput,
      session
    );

    // 2. 构建增强提示
    const enhancedPrompt = this.buildRAGPrompt(
      userInput,
      session,
      knowledgeResults
    );

    // 3. LLM生成响应
    const response = await this.bedrock.generateResponse(enhancedPrompt);

    return response;
  }

  private buildRAGPrompt(
    userInput: string,
    session: CallSkeleton,
    knowledge: KnowledgeResult[]
  ): string {
    return `
基于以下知识库信息回答客户问题：

相关知识：
${knowledge.map(k => `- ${k.title}: ${k.content}`).join('\n')}

客户问题：${userInput}

会话上下文：${this.formatSession(session)}

请基于知识库信息提供准确、有用的回答。
`;
  }
}
```

### 3.2 高级业务逻辑工具

#### 邮件和通知工具
```typescript
// mcp/session/src/tools/notification.tools.ts
export class NotificationTools {
  @mcpTool("send_booking_confirmation")
  async sendBookingConfirmation(bookingData: {
    customerEmail: string;
    serviceName: string;
    dateTime: string;
    location: string;
    instructions: string;
  }): Promise<{ success: boolean; messageId: string }>

  @mcpTool("send_sms_reminder")
  async sendSMSReminder(
    phoneNumber: string,
    message: string,
    scheduleTime?: string
  ): Promise<{ success: boolean; messageId: string }>

  @mcpTool("create_calendar_event")
  async createCalendarEvent(eventData: {
    title: string;
    startTime: string;
    endTime: string;
    attendees: string[];
    description: string;
  }): Promise<{ success: boolean; eventId: string }>
}
```

#### 外部API集成工具
```typescript
// mcp/session/src/tools/external.tools.ts
export class ExternalTools {
  @mcpTool("check_payment_status")
  async checkPaymentStatus(bookingId: string): Promise<{
    status: 'pending' | 'completed' | 'failed';
    amount: number;
    paymentMethod: string;
  }>

  @mcpTool("process_payment")
  async processPayment(paymentData: {
    amount: number;
    currency: string;
    customerId: string;
    description: string;
  }): Promise<{ success: boolean; transactionId: string }>

  @mcpTool("get_weather_info")
  async getWeatherInfo(location: string, date: string): Promise<{
    temperature: number;
    conditions: string;
    recommendation: string;
  }>
}
```

### 3.3 智能对话管理

#### 多轮对话状态追踪
```typescript
// agent/src/services/conversation.service.ts
export class ConversationService {
  async analyzeConversationFlow(session: CallSkeleton): Promise<{
    completionPercentage: number;
    missingInformation: string[];
    recommendedQuestions: string[];
    shouldTransferToHuman: boolean;
    estimatedRemainingTime: number;
  }>

  async detectEmotionalState(
    message: string,
    history: EnhancedMessage[]
  ): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral';
    emotion: string;
    confidence: number;
    suggestedResponse: string;
  }>

  async generateFollowUpQuestions(
    intent: string,
    collectedInfo: Record<string, any>,
    availableServices: Service[]
  ): Promise<string[]>
}
```

#### 智能错误恢复
```typescript
// agent/src/services/error-recovery.service.ts
export class ErrorRecoveryService {
  async handleMisunderstanding(
    userInput: string,
    session: CallSkeleton,
    previousAttempts: number
  ): Promise<{
    clarificationQuestion: string;
    simplifiedOptions: string[];
    fallbackToHuman: boolean;
  }>

  async detectAndRecoverFromErrors(
    errorType: 'technical' | 'understanding' | 'data',
    context: any
  ): Promise<{
    recoveryAction: string;
    userMessage: string;
    logData: any;
  }>
}
```

### 3.4 性能优化和监控

#### 智能缓存策略
```typescript
// agent/src/services/cache.service.ts
export class CacheService {
  // 缓存LLM响应
  async cacheResponse(
    inputHash: string,
    response: string,
    ttl: number = 3600
  ): Promise<void>

  // 缓存知识库搜索结果
  async cacheKnowledgeSearch(
    query: string,
    results: KnowledgeResult[],
    ttl: number = 1800
  ): Promise<void>

  // 预热常用数据
  async preloadCommonData(companyId: string): Promise<void>
}
```

#### 监控和分析
```typescript
// agent/src/services/analytics.service.ts
export class AnalyticsService {
  async trackConversationMetrics(
    callSid: string,
    metrics: {
      responseTime: number;
      tokensUsed: number;
      toolCallsCount: number;
      userSatisfaction?: number;
      conversionRate?: number;
    }
  ): Promise<void>

  async generateInsights(
    timeRange: { start: Date; end: Date }
  ): Promise<{
    totalConversations: number;
    averageResolutionTime: number;
    topIntents: string[];
    successRate: number;
    recommendations: string[];
  }>
}
```

---

## 🎯 里程碑和交付物

### 阶段一交付物
- [ ] Bedrock集成的Agent Lambda
- [ ] 增强的prompt engineering框架
- [ ] 基础LLM对话能力
- [ ] 上下文管理系统
- [ ] 基础测试套件

### 阶段二交付物
- [ ] 完整的MCP工具生态系统
- [ ] 数据库CRUD工具集
- [ ] 多步骤业务流程支持
- [ ] 智能路由和状态管理
- [ ] 工具调用链执行器

### 阶段三交付物
- [ ] RAG知识库系统
- [ ] 外部系统集成工具
- [ ] 智能对话管理
- [ ] 性能优化和缓存
- [ ] 全面监控和分析

---

## 🛠️ 技术栈最终架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Internet Users                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  API Gateway                                │
│                 /v1/assist                                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│               Agent Lambda                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │  LangGraph  │ │   Bedrock   │ │Tool Executor│           │
│  │   Agent     │ │   Claude    │ │   Service   │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                MCP Session Server                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │  Database   │ │  Session    │ │Notification │           │
│  │   Tools     │ │   Tools     │ │   Tools     │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│               Data Layer                                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │    Redis    │ │  DynamoDB   │ │ OpenSearch  │           │
│  │ (Sessions)  │ │ (Business)  │ │   (RAG)     │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

这个计划将把你的agent系统从简单的关键词匹配升级为完整的企业级智能助手！