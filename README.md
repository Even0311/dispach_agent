# Dispatch Agent - AI Voice Assistant System

一个基于AWS的AI语音助手系统，使用LangGraph实现对话流程，MCP (Model Context Protocol) 管理会话状态，支持Twilio语音通话集成。

## 🏗️ 系统架构

### 主体架构 (Main Agent System)
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Gateway   │───▶│  Agent Lambda    │───▶│  LangGraph Agent│
│   /v1/assist    │    │  (Node.js 20)    │    │  + Intent AI    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │  Environment    │    │  MCP HTTP Client│
                       │  Variables      │    │  Session Mgmt   │
                       └─────────────────┘    └─────────────────┘
                                                       │
                                                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Redis          │◀───│  MCP Session     │◀───│  Load Balancer  │
│  ElastiCache    │    │  Server (ECS)    │    │  (Internal ALB) │
│  (会话存储)      │    │  (Express API)   │    │  (VPC Internal) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Twilio集成架构 (Telephony Integration)
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Twilio Voice   │───▶│  Voice Handler   │───▶│  Welcome Logic  │
│  Webhook        │    │  Lambda          │    │  + Call Setup   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Twilio Gather  │───▶│  Gather Handler  │───▶│  AI Integration │
│  (Speech Input) │    │  Lambda          │    │  + Conversation │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Twilio Status  │───▶│  Status Handler  │    │  DynamoDB       │
│  Callback       │    │  Lambda          │    │  7个表 + Redis   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 完整系统拓扑
```
Internet
    │
    ▼
┌─────────────────┐         ┌─────────────────┐
│  API Gateway    │         │  Twilio         │
│  (Public)       │         │  Function URLs  │
└─────────────────┘         └─────────────────┘
    │                               │
    ▼                               ▼
┌─────────────────┐         ┌─────────────────┐
│  VPC            │         │  3x Lambda      │
│  3-AZ Deployment│         │  Voice/Gather/  │
│                 │         │  Status         │
│  ┌─────────────┐│         │                 │
│  │Agent Lambda ││         │  ┌─────────────┐│
│  └─────────────┘│         │  │DynamoDB 7表 ││
│         │        │         │  └─────────────┘│
│         ▼        │         │         │       │
│  ┌─────────────┐│         │         ▼       │
│  │ECS Fargate  ││         │  ┌─────────────┐│
│  │MCP Session  ││◀────────┼──│   Redis     ││
│  │Server       ││         │  │ ElastiCache ││
│  └─────────────┘│         │  └─────────────┘│
│         │        │         └─────────────────┘
│         ▼        │
│  ┌─────────────┐│
│  │Redis Cluster││
│  │(Isolated)   ││
│  └─────────────┘│
└─────────────────┘
```

## 🎯 核心功能

### 主系统组件 (Main Agent System)

#### 1. AI对话Agent (LangGraph)
- **位置**: `agent/src/agent.ts`
- **流程**: `loadSession → echoIntent → updateSession → reply`
- **技术栈**: LangGraph, LangChain Core, AWS Lambda Powertools
- **功能**:
  - 加载/创建会话 (HTTP调用MCP Server)
  - 意图识别（预订、取消、信息查询、通用）
  - 更新会话状态 (追加消息历史)
  - 生成智能回复 (基于上下文和意图)

#### 2. MCP Session Server (HTTP)
- **位置**: `mcp/session/src/index.ts`
- **部署**: ECS Fargate + Internal Application Load Balancer
- **技术栈**: Express.js, ioredis, @modelcontextprotocol/sdk
- **功能**:
  - SessionRepository模式的会话管理
  - RESTful API接口 (/session, /mcp/tools)
  - Redis存储with TTL (2小时过期)
  - 健康检查端点
  - MCP工具接口实现

#### 3. Agent Lambda函数
- **位置**: `agent/src/index.ts`
- **运行时**: Node.js 20.x, ARM64架构
- **网络**: VPC私有子网，安全组控制
- **功能**:
  - API Gateway集成 (/v1/assist)
  - 调用LangGraph Agent核心逻辑
  - 全面错误处理和CloudWatch日志
  - CORS支持

### Twilio集成组件 (Legacy Telephony System)

#### 4. Voice Handler Lambda
- **位置**: `telephony-lambdas/voice-handler/index.ts`
- **功能**:
  - 处理Twilio语音webhook调用
  - 生成欢迎消息和呼叫设置
  - 重定向到Gather Handler进行语音收集

#### 5. Gather Handler Lambda
- **位置**: `telephony-lambdas/gather-handler/index.ts`
- **功能**:
  - 处理Twilio Gather语音输入
  - 集成AI服务进行对话处理
  - 管理对话流程和状态转换

#### 6. Status Handler Lambda
- **位置**: `telephony-lambdas/status-handler/index.ts`
- **功能**:
  - 处理Twilio状态回调
  - 持久化通话数据到DynamoDB
  - 生成通话摘要和分析

### 基础设施组件

#### 7. CDK Infrastructure Stacks
- **主栈**: `infra/lib/dispatch-agent-stack.ts`
  - VPC (3-AZ, 公有/私有/隔离子网)
  - Redis ElastiCache集群 (单节点，t3.micro)
  - ECS Fargate服务 + Internal ALB
  - Agent Lambda + API Gateway
  - 7个DynamoDB表 + S3存储桶
  - 安全组和网络配置

- **Telephony栈**: `infra/lib/telephony-lambdas-stack.ts`
  - 3个Telephony Lambda函数 (Voice/Gather/Status)
  - Lambda Function URLs (替代API Gateway)
  - DynamoDB访问权限 + S3权限
  - VPC网络集成 + Redis访问权限

## 📋 API接口

### 主系统API

#### Agent API (通过API Gateway)
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

#### MCP Session Server API (内部)
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

### Twilio集成API

#### Telephony Lambda Function URLs
```bash
# Voice Webhook (Twilio → Voice Handler)
POST {VoiceHandlerUrl}
Content-Type: application/x-www-form-urlencoded
# Twilio标准语音webhook参数

# Gather Webhook (Twilio → Gather Handler)
POST {GatherHandlerUrl}
Content-Type: application/x-www-form-urlencoded
# Twilio Gather结果 + 语音识别文本

# Status Callback (Twilio → Status Handler)
POST {StatusHandlerUrl}
Content-Type: application/x-www-form-urlencoded
# Twilio通话状态更新
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
dispatch-agent/                    # PNPM Workspace 根目录
├── agent/                         # AI Agent Lambda (主系统核心)
│   ├── src/
│   │   ├── index.ts              # Lambda入口点 + API Gateway集成
│   │   ├── agent.ts              # LangGraph Agent核心逻辑
│   │   └── mcp-client.ts         # MCP HTTP客户端
│   ├── dist/                     # 编译输出 (CDK部署源)
│   └── package.json              # LangGraph + LangChain依赖
│
├── mcp/session/                   # MCP Session Management Server
│   ├── src/
│   │   └── index.ts              # Express HTTP服务器 + MCP实现
│   ├── Dockerfile                # 容器构建文件 (ECS部署)
│   └── package.json              # Express + ioredis + MCP SDK
│
├── types/                         # 共享TypeScript类型定义
│   ├── src/
│   │   └── index.ts              # CallSkeleton, Message, Service等接口
│   └── package.json              # 类型包，供其他包引用
│
├── telephony-lambdas/             # Twilio语音集成系统 (Legacy)
│   ├── shared/                   # 共享代码库
│   │   ├── types/                # DynamoDB实体类型定义
│   │   ├── services/             # 业务逻辑服务类
│   │   │   ├── dynamodb/         # DynamoDB数据访问层 (7个表)
│   │   │   ├── ai/               # AI服务集成 (待连接主Agent)
│   │   │   └── external/         # 外部服务调用 (邮件/日历)
│   │   ├── helpers/              # 数据转换和验证辅助
│   │   └── constants/            # 系统常量和响应模板
│   ├── voice-handler/            # Twilio语音Webhook处理器
│   │   └── index.ts              # 欢迎消息 + 通话设置
│   ├── gather-handler/           # Twilio语音收集处理器
│   │   └── index.ts              # 语音识别 + AI对话
│   ├── status-handler/           # Twilio状态回调处理器
│   │   └── index.ts              # 通话结束 + 数据持久化
│   ├── dist/                     # 编译输出 (CDK部署源)
│   └── package.json              # Twilio SDK + AWS SDK + 共享依赖
│
├── infra/                         # AWS CDK基础设施定义
│   ├── lib/
│   │   ├── dispatch-agent-stack.ts    # 主系统基础设施
│   │   │                               # (VPC+Redis+ECS+Lambda+API Gateway)
│   │   └── telephony-lambdas-stack.ts  # Twilio集成基础设施
│   │       │                          # (3个Lambda+DynamoDB+Function URLs)
│   │   ├── bin/
│   │   │   └── infra.ts              # CDK App入口点
│   │   └── package.json              # AWS CDK v2依赖
│
├── package.json                   # 根工作区配置 (PNPM workspace)
├── pnpm-workspace.yaml           # PNPM工作区定义
└── README.md                      # 项目文档 (本文件)

技术栈汇总:
─────────────────────────────────────────────────────
│ 组件                │ 技术栈                        │
│────────────────────│─────────────────────────────│
│ Agent Lambda       │ Node.js 20, LangGraph,       │
│                    │ LangChain, AWS Lambda         │
│────────────────────│─────────────────────────────│
│ MCP Session Server │ Express.js, ioredis,          │
│                    │ MCP SDK, ECS Fargate          │
│────────────────────│─────────────────────────────│
│ Telephony Lambdas  │ Node.js 20, Twilio SDK,      │
│                    │ AWS SDK v3, DynamoDB          │
│────────────────────│─────────────────────────────│
│ Infrastructure     │ AWS CDK v2, TypeScript        │
│────────────────────│─────────────────────────────│
│ Storage           │ Redis ElastiCache,            │
│                    │ DynamoDB, S3                  │
─────────────────────────────────────────────────────
```

---

## 🎯 下一步计划

### 集成和连接 (Integration Phase)
- [ ] **连接Telephony → Agent**: 修改`telephony-lambdas/shared/services/ai/ai-integration.service.ts`调用主Agent Lambda
- [ ] **统一会话管理**: 整合Telephony的Redis会话与主系统MCP会话
- [ ] **数据模型对齐**: 统一CallSkeleton与DynamoDB数据结构

### 功能增强 (Enhancement Phase)
- [ ] **智能意图识别**: 从关键词匹配升级到NLP模型集成
- [ ] **完整预订流程**: 实现端到端的服务预订逻辑
- [ ] **通知系统**: 集成邮件发送和日历API
- [ ] **用户认证**: 添加用户身份验证和授权

### 架构优化 (Optimization Phase)
- [ ] **监控体系**: CloudWatch Alarms + X-Ray分布式追踪
- [ ] **性能优化**: 缓存策略 + 连接池优化
- [ ] **错误恢复**: 电路断路器 + 重试机制改进
- [ ] **安全加固**: WAF + API限流 + 数据加密

### 运维和测试 (DevOps Phase)
- [ ] **CI/CD Pipeline**: 自动化构建 + 部署 + 回滚
- [ ] **环境管理**: 开发/测试/生产环境分离
- [ ] **压力测试**: 负载测试 + 容量规划
- [ ] **文档完善**: API文档 + 运维手册

## 🔗 系统集成策略

### 当前状态
- ✅ **主Agent系统**: 完整实现 (LangGraph + MCP + Redis)
- ✅ **Twilio集成**: 独立运行 (3个Lambda + DynamoDB)
- ❌ **系统间连接**: 未连接 (ai-integration.service.ts仍为mock)

### 集成方案
1. **Phase 1**: 修改`getAIReply`方法调用主Agent Lambda的`/v1/assist`接口
2. **Phase 2**: 统一会话存储，使用主系统的MCP Session Server
3. **Phase 3**: 逐步迁移DynamoDB数据到统一的CallSkeleton模型
4. **Phase 4**: 废弃Telephony独立的Redis，全面使用主系统架构