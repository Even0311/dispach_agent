# Dispatch Agent - AI Voice Assistant System

一个基于AWS的AI语音助手系统，使用LangGraph实现对话流程，MCP (Model Context Protocol) 管理会话状态，Redis存储会话数据。

## 🏗️ 系统架构

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Gateway   │───▶│  Lambda Function │───▶│  Agent (LangGraph) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │  Environment    │    │  MCP Client     │
                       │  Variables      │    │  (HTTP calls)   │
                       └─────────────────┘    └─────────────────┘
                                                       │
                                                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Redis          │◀───│  MCP Session     │◀───│  Load Balancer  │
│  ElastiCache    │    │  Server (ECS)    │    │  (Internal ALB) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🎯 核心功能

### 1. AI对话Agent (LangGraph)
- **位置**: `agent/src/agent.ts`
- **流程**: `loadSession → echoIntent → updateSession → reply`
- **功能**:
  - 加载/创建会话
  - 意图识别（预订、取消、信息查询、通用）
  - 更新会话状态
  - 生成智能回复

### 2. MCP Session Server (HTTP)
- **位置**: `mcp/session/src/index.ts`
- **部署**: ECS Fargate + Application Load Balancer
- **功能**:
  - SessionRepository模式的会话管理
  - RESTful API接口
  - Redis存储with TTL (2小时过期)
  - 健康检查端点

### 3. Lambda函数
- **位置**: `agent/src/index.ts`
- **功能**:
  - API Gateway集成
  - 调用LangGraph Agent
  - 错误处理和日志

### 4. CDK基础设施
- **位置**: `infra/lib/dispatch-agent-stack.ts`
- **资源**:
  - VPC (公有/私有子网)
  - Redis ElastiCache集群
  - ECS Fargate服务
  - Application Load Balancer (内部)
  - Lambda函数
  - API Gateway
  - 安全组和网络配置

## 📋 API接口

### Lambda API (通过API Gateway)
```
POST /v1/assist
Content-Type: application/json

{
  "callSid": "string",    // 通话唯一标识
  "text": "string"        // 用户输入文本
}

Response:
{
  "reply": "string"       // AI回复
}
```

### MCP Session Server API
```bash
# 健康检查
GET /health

# 会话管理
POST   /session/{callSid}           # 创建会话
GET    /session/{callSid}           # 获取会话
PATCH  /session/{callSid}           # 更新会话
DELETE /session/{callSid}           # 删除会话

# 消息管理
POST   /session/{callSid}/messages  # 追加消息
POST   /session/{callSid}/touch     # 更新时间戳

# MCP工具接口
POST   /mcp/tools                   # 列出可用工具
POST   /mcp/tools/{toolName}        # 调用指定工具
```

## 🔧 数据结构

### CallSkeleton
```typescript
interface CallSkeleton {
  callSid: string;                    // 通话唯一标识
  services: readonly Service[];      // 可用服务列表
  company: Company;                   // 公司信息
  user: {
    service?: Service;                // 选中的服务
    serviceBookedTime?: string;       // 预订时间
    userInfo: Partial<UserInfo>;      // 用户信息
  };
  history: Message[];                 // 对话历史
  servicebooked: boolean;             // 是否已预订
  confirmEmailsent: boolean;          // 确认邮件是否已发送
  createdAt?: string;                 // 创建时间
}
```

### Message
```typescript
interface Message {
  speaker: 'AI' | 'customer';        // 说话者
  message: string;                    // 消息内容
  startedAt: string;                  // 消息时间
}
```

### Service
```typescript
interface Service {
  id: string;                         // 服务ID
  name: string;                       // 服务名称
  price: number | null;               // 价格
  description?: string;               // 服务描述
}
```

## 🛠️ SessionRepository操作

### 核心方法
```typescript
class SessionRepository {
  async load(callSid: string): Promise<CallSkeleton | null>
  async create(callSid: string): Promise<CallSkeleton>
  async save(session: CallSkeleton): Promise<void>
  async delete(callSid: string): Promise<void>
  async appendHistory(callSid: string, entry: Message): Promise<void>
  async appendServices(callSid: string, services: Service[]): Promise<void>
}
```

### Redis存储模式
- **Key格式**: `sess:{callSid}`
- **存储方式**: JSON字符串
- **TTL**: 7200秒 (2小时)
- **操作**: GET/SET/DEL (不使用RedisJSON)

## 🚀 部署命令

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 部署基础设施
pnpm deploy
```

## 🔄 对话流程

1. **用户请求** → API Gateway → Lambda
2. **Lambda** → 初始化Agent → 调用processRequest
3. **Agent.loadSession** → MCP Client → Session Server → Redis
4. **Agent.echoIntent** → 分析用户意图 (booking/cancel/info/general)
5. **Agent.updateSession** → 更新会话状态 → 追加用户消息
6. **Agent.reply** → 生成回复 → 追加AI消息
7. **响应** → Lambda → API Gateway → 用户

## 🌟 技术特点

### 高可用性
- ✅ AWS托管服务 (ElastiCache, ECS, Lambda, ALB)
- ✅ VPC网络隔离
- ✅ 安全组访问控制
- ✅ 健康检查和自动恢复

### 可扩展性
- ✅ ECS Fargate自动扩展
- ✅ Lambda无服务器架构
- ✅ Redis集群支持
- ✅ 负载均衡器分发

### 可维护性
- ✅ TypeScript类型安全
- ✅ 模块化架构设计
- ✅ SessionRepository模式
- ✅ HTTP RESTful API
- ✅ 完整的错误处理和日志

### 性能优化
- ✅ Redis会话缓存
- ✅ TTL自动过期
- ✅ 简化的Redis操作
- ✅ 内部网络通信

## 🔍 监控和调试

### 日志位置
- **Lambda**: CloudWatch Logs
- **ECS**: CloudWatch Logs (mcp-session stream)
- **Redis**: ElastiCache监控面板

### 健康检查
```bash
# MCP Server健康检查
curl http://<alb-dns-name>/health

# 会话测试
curl -X POST http://<alb-dns-name>/session/test-call-123
```

### 环境变量
```bash
# Lambda环境变量
NODE_ENV=production
MCP_SESSION_URL=http://<internal-alb-dns>
REDIS_HOST=<redis-endpoint>
REDIS_PORT=6379

# ECS环境变量
NODE_ENV=production
PORT=3000
REDIS_HOST=<redis-endpoint>
REDIS_PORT=6379
```

## 📁 项目结构

```
dispatch-agent/
├── agent/                  # Lambda函数
│   ├── src/
│   │   ├── index.ts       # Lambda入口点
│   │   ├── agent.ts       # LangGraph Agent
│   │   └── mcp-client.ts  # MCP HTTP客户端
│   └── package.json
├── mcp/session/           # MCP Session Server
│   ├── src/
│   │   └── index.ts       # Express HTTP服务器
│   ├── Dockerfile         # 容器构建文件
│   └── package.json
├── types/                 # 共享类型定义
│   ├── src/
│   │   └── index.ts       # 接口定义
│   └── package.json
├── infra/                 # CDK基础设施
│   ├── lib/
│   │   └── dispatch-agent-stack.ts
│   └── package.json
└── package.json           # 根配置文件
```

---

## 🎯 下一步计划

- [ ] 添加更复杂的意图识别（NLP集成）
- [ ] 实现服务预订逻辑
- [ ] 添加邮件发送功能
- [ ] 集成日历API
- [ ] 添加用户认证
- [ ] 实现WebSocket实时通信
- [ ] 添加监控和报警
- [ ] 性能优化和压力测试