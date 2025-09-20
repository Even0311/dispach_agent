# MCP Implementation Guide - Comprehensive Learning Notes

> 深度学习MCP-Project示例代码的完整总结，包含Server和Client的正确实现模式

## 🎯 核心架构理解

### MCP HTTP Transport的真实实现

**重要发现**：HTTP transport不是直接使用StreamableHTTPServerTransport作为服务器，而是：
```
Express HTTP Server + StreamableHTTPServerTransport (处理MCP协议层)
```

## 📋 Client端实现 (client.ts)

### StreamableHTTPClientTransport 正确用法

```typescript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ✅ 正确的构造方式
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: {
      ["x-api-key"]: `Bearer 1234567890`,
    },
  },
});

// ✅ 连接到服务器
await this.client.connect(this.transport, {
  timeout: 10000000,  // 可设置超时
});
```

### 关键Client实现要点

1. **Transport事件处理**：
```typescript
this.transport.onclose = () => {
  console.log("transport closed.");
  this.isCompleted = true;
};

this.transport.onerror = async (error) => {
  console.log("transport error: ", error);
  await this.cleanup();
};

// 🚨 重要：不要设置onmessage，会干扰请求响应
// this.transport.onmessage = (message) => { ... };
```

2. **Client实例化**：
```typescript
this.client = new Client({
  name: `mcp-client`,
  version: "1.0.0",
});
```

3. **会话ID管理**：
   - transport自动生成UUID作为sessionId
   - 通过`transport.sessionId`访问

### StdioClientTransport用法

```typescript
this.transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp-servers/server.ts"],
});
```

## 🖥️ Server端实现 (mcp-server/)

### HTTP Server架构模式

**关键理解**：对于httpstream transport，使用Express而不是直接的StreamableHTTPServerTransport

```typescript
// index.ts - 主入口
if (transportType === "stdio") {
  // 直接使用MCP Server + StdioServerTransport
  const server = initServer({ authToken });
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else if (transportType === "httpstream") {
  // 使用Express + 路由系统
  const app = express();
  app.use(express.json());

  const rootRouter = createRootRouter({ port, authToken });
  app.use("/", rootRouter);

  app.listen(port, () => {
    console.log(`END POINT: http://localhost:${port}/mcp`);
  });
}
```

### 核心MCP路由实现 (routes/mcp.ts)

**这是最重要的部分** - StreamableHTTPServerTransport的正确用法：

```typescript
export function createMCPRouter(options: { authToken: string }): Router {
  const router: Router = Router();

  // 会话管理 - 每个会话独立的server和transport
  const sessions = new Map<string, {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  }>();

  router.post("/", async (req, res) => {
    const sid = req.headers["mcp-session-id"];

    let transport: StreamableHTTPServerTransport;
    let server: McpServer;

    if (sid && typeof sid === "string") {
      // 现有会话 - 从Map中获取
      const session = sessions.get(sid);
      if (!session) {
        res.status(404).json({...}); // 会话不存在
        return;
      }
      server = session.server;
      transport = session.transport;

    } else if (!sid && isInitializeRequest(req.body)) {
      // 新会话 - 创建transport和server
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { transport, server });
          console.log(`⭐️ New session initialized: ${sessionId}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      server = initServer({ authToken });
      await server.connect(transport);
    }

    // 🎯 关键：使用transport处理HTTP请求
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
```

### Server实例创建 (server.ts)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function initServer(options: { authToken: string }): McpServer {
  const server = new McpServer({
    name: "notion-mcp-server",
    version: "0.0.1",
  });

  registerTool(server, { authToken });
  return server;
}
```

### 工具注册模式 (tools.ts)

```typescript
export function registerTool(server: McpServer, options: { authToken?: string }) {
  // 🔦 注册工具的标准方式
  server.tool(
    "post-search",           // 工具名称
    "Search by title",       // 工具描述
    SearchRequestSchema,     // Zod schema验证
    async ({ query, sort, filter, page_size }) => {
      // 工具实现逻辑
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${authToken}`,
          "notion-version": "2022-06-28",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      return await response.json();
    }
  );
}
```

## 🔗 完整的HTTP调用流程

### Client → Server HTTP调用链

1. **Client发起调用**：
```typescript
const result = await client.listTools();
const toolResult = await client.callTool({
  name: "add",
  arguments: { a: 1, b: 3 }
});
```

2. **HTTP层传输**：
   - POST to `http://localhost:8080/mcp`
   - Header: `mcp-session-id: {uuid}` (后续请求)
   - Body: JSON-RPC 2.0格式

3. **Server端处理**：
   - Express路由接收 → `/mcp` endpoint
   - 检查session-id → 获取或创建session
   - `transport.handleRequest(req, res, req.body)` → MCP协议处理
   - 工具执行 → 返回结果

### 会话管理机制

```typescript
// 初始化请求（没有session-id）
if (!sid && isInitializeRequest(req.body)) {
  // 创建新的transport和server实例
}

// 后续请求（有session-id）
if (sid && typeof sid === "string") {
  // 复用现有的transport和server实例
}
```

## ⚡ 关键技术要点

### 1. StreamableHTTPServerTransport配置
```typescript
new StreamableHTTPServerTransport({
  sessionIdGenerator: randomUUID,  // 会话ID生成器
  onsessioninitialized: (sessionId) => {
    // 会话初始化回调
    sessions.set(sessionId, { transport, server });
  },
});
```

### 2. 错误处理模式
```typescript
const badRequestResponse: JSONRPCError = {
  jsonrpc: "2.0",
  id: req.body?.id ?? null,
  error: {
    code: -32000,
    message: "❌ Bad Request: Invalid request",
  },
};
```

### 3. 路由结构
```typescript
// routes/index.ts
rootRouter.use("/health", healthCheckRouter);
rootRouter.use("/mcp", authMiddleware, mcpRouter);  // 认证 + MCP处理
```

## 🚀 实践应用指南

### 对于我们的Session Server

基于这些学习，我们的实现应该：

1. **保持Express HTTP服务器**
2. **在/mcp路由中使用StreamableHTTPServerTransport**
3. **实现会话管理（Map存储）**
4. **每个会话独立的server实例**

### 关键修改点

```typescript
// ❌ 错误：直接使用StreamableHTTPServerTransport作为服务器
const transport = new StreamableHTTPServerTransport(url);
await server.connect(transport);

// ✅ 正确：Express + MCP路由 + transport.handleRequest
app.post('/mcp', async (req, res) => {
  // 会话管理逻辑
  await transport.handleRequest(req, res, req.body);
});
```

## 📚 核心API总结

### Client端API
- `new StreamableHTTPClientTransport(url, options)`
- `client.connect(transport, { timeout })`
- `client.listTools()`, `client.callTool(...)`
- Transport事件：`onclose`, `onerror`

### Server端API
- `new McpServer({ name, version })`
- `server.tool(name, description, schema, handler)`
- `new StreamableHTTPServerTransport({ sessionIdGenerator, onsessioninitialized })`
- `transport.handleRequest(req, res, body)`

---

## 🏠 MCP Host实现 (mcp-host/)

### MCP Host概念

**MCP Host** = 使用MCP客户端连接到多个MCP服务器，并将MCP工具集成到AI应用中的中间层

### 手动MCP Host实现 (function-calling-host.ts)

#### 1. 多客户端连接管理

```typescript
// 支持多种transport的泛型客户端
class MCPClient<T extends TransportType = TransportType> {
  #client: Client;
  #transportType: T;
  #transport: StreamableHTTPClientTransport | StdioClientTransport | null = null;

  constructor({ transportType }: { transportType: T }) {
    this.#client = new Client({
      name: "mcp-client",
      version: "1.0.0",
    });
    this.#transportType = transportType;
  }

  // 类型安全的连接方法
  async connectToServer(
    ...args: T extends "httpStream"
      ? [serverUrl: string]
      : [{ command: string; args: string[] }]
  ) {
    if (this.#transportType === "httpStream") {
      this.#transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            ["x-api-key"]: `Bearer 1234567890`,
          },
        },
      });

      await this.#client.connect(this.#transport, { timeout: 1000 });
    } else {
      this.#transport = new StdioClientTransport({ command, args });
      await this.#client.connect(this.#transport);
    }
  }
}
```

#### 2. 工具转换：MCP → Anthropic

```typescript
// 🎯 关键函数：将MCP工具转换为Anthropic function calling工具
function convertModelContextProtocolToolsToAnthropicTools(
  tools: ModelContextProtocolTool[]
): AnthropicTool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,  // 直接映射JSON Schema
  }));
}

// 获取所有工具并转换
const { tools: mcpTools } = await client.listTools();
const anthropicTools = convertModelContextProtocolToolsToAnthropicTools(mcpTools);
```

#### 3. 完整的Function Calling流程

```typescript
// 步骤1：LLM调用工具
const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20240620",
  messages: messageHistory,
  tools: anthropicTools,
});

// 步骤2：处理工具调用
if (response.stop_reason === "tool_use") {
  const toolCalls = response.content.filter(item => item.type === "tool_use");

  for (const toolCall of toolCalls) {
    const { name, input } = toolCall;

    // 步骤3：找到对应的MCP客户端
    const client = getClientForTool(name);

    // 步骤4：执行MCP工具调用
    const toolResult = await client.client.callTool({
      name,
      arguments: input,
    });

    // 步骤5：处理结果并格式化为Anthropic格式
    const toolResultContent: ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: toolResult.content,
      is_error: toolResult.isError,
    };
  }
}
```

#### 4. 客户端工具映射管理

```typescript
// 多客户端工具管理
const toolsPerClient = {
  ["1"]: { tools: mcpToolsHttpStream, client: client1 },
  ["2"]: { tools: mcpToolsStdio, client: client2 },
} as const;

// 根据工具名称找到对应客户端
function getClientForTool(toolName: string) {
  for (const { tools, client } of Object.values(toolsPerClient)) {
    if (tools.some(tool => tool.name === toolName)) {
      return client;
    }
  }
  return null;
}
```

### LangChain MCP适配器 (langgraph-raw.ts)

#### MultiServerMCPClient - 高级抽象

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

// 🚀 一行代码连接多个MCP服务器
const multiServerMCPClient = new MultiServerMCPClient({
  mcpServers: {
    context7: {
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest"],
    },
    "personal-mcp-server": {
      url: "http://localhost:8080/mcp",
      headers: {
        "x-api-key": "Bearer 1234567890",
        "x-mcp-toolsets": "calculate_bmi, get_weather, delete_file",
      },
    },
    "file-system": {
      command: "npx",
      args: ["tsx", "src/mcp-servers/low-level-file-system.ts"],
    },
  },
});

// 🎯 自动获取所有LangChain兼容的工具
const llmCompatibleTools = await multiServerMCPClient.getTools();
```

#### LangGraph集成

```typescript
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph } from "@langchain/langgraph";

// 🔧 创建工具节点
const toolNode = new ToolNode(llmCompatibleTools);

// 🤖 绑定工具到模型
const modelWithTools = model.bindTools(llmCompatibleTools);

// 📊 构建LangGraph工作流
const workflow = new StateGraph(GraphAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

// 🏃‍♂️ 执行工作流
const app = workflow.compile({ checkpointer });
const state = await app.invoke({
  messages: [new HumanMessage("what are the tools available?")],
});
```

### JSON配置驱动 (mcp-v3.json)

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    },
    "personal-mcp-server": {
      "url": "http://localhost:8080/mcp",
      "headers": {
        "x-api-key": "Bearer 1234567890",
        "x-mcp-toolsets": "calculate_bmi, get_weather, delete_file"
      }
    },
    "file-system": {
      "command": "npx",
      "args": ["tsx", "src/mcp-servers/low-level-file-system.ts"]
    }
  }
}
```

## 🔄 MCP Host架构模式对比

### 手动实现 vs LangChain适配器

| 特性 | 手动实现 | LangChain适配器 |
|------|----------|-----------------|
| **复杂度** | 高，需要处理所有细节 | 低，高级抽象 |
| **灵活性** | 极高，完全控制 | 中等，配置驱动 |
| **工具转换** | 手动映射 | 自动转换 |
| **错误处理** | 自定义实现 | 内置处理 |
| **多服务器** | 手动管理 | 自动聚合 |
| **适用场景** | 复杂定制需求 | 快速原型和标准用例 |

### 架构选择建议

```typescript
// 🎯 选择1：简单快速 - 使用LangChain适配器
const client = new MultiServerMCPClient({ mcpServers });
const tools = await client.getTools();
const workflow = createReactAgent({ llm, tools });

// 🎯 选择2：完全控制 - 手动实现
class CustomMCPHost {
  async connectToServers() { /* 自定义连接逻辑 */ }
  async convertTools() { /* 自定义工具转换 */ }
  async executeWorkflow() { /* 自定义执行流程 */ }
}
```

## 🚀 实践应用指南

### 对于我们的Session Management项目

基于MCP Host学习，我们可以：

1. **创建Session MCP Host**：
   ```typescript
   const sessionHost = new MCPClient({ transportType: "httpStream" });
   await sessionHost.connectToServer("http://session-server:3000/mcp");
   const sessionTools = await sessionHost.client.listTools();
   ```

2. **集成到LangGraph**：
   ```typescript
   const sessionMCPClient = new MultiServerMCPClient({
     mcpServers: {
       "session-management": {
         url: "http://session-server:3000/mcp",
         headers: { "Authorization": "Bearer token" }
       }
     }
   });

   const tools = await sessionMCPClient.getTools();
   const agent = createReactAgent({ llm, tools });
   ```

3. **Lambda集成**：
   ```typescript
   // Lambda中使用MCP Host连接到ECS上的session server
   const mcpHost = new MCPClient({ transportType: "httpStream" });
   await mcpHost.connectToServer(process.env.SESSION_SERVER_URL);
   ```

---

**总结**：MCP Host是连接MCP生态的关键组件，提供了工具聚合、协议转换和AI集成的完整解决方案。手动实现提供最大灵活性，LangChain适配器提供最快开发速度。MCP的HTTP实现是一个分层架构，Express处理HTTP传输，StreamableHTTPServerTransport处理MCP协议，每个客户端会话维护独立的server实例。这种设计既保证了协议的标准性，又提供了HTTP的灵活性。