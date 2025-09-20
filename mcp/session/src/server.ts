#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  isInitializeRequest,
  JSONRPCError,
} from '@modelcontextprotocol/sdk/types.js';
import express, { Router } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { CallSkeleton, Service, Message } from '@dispatch-agent/types';

// Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: 3,
});

// Constants
const SESSION_TTL = 7200; // 2 hours in seconds

// Helper functions
function getSessionKey(callSid: string): string {
  return `sess:${callSid}`;
}

function createEmptySkeleton(callSid: string): CallSkeleton {
  return {
    callSid,
    services: [],
    company: {
      id: "default",
      name: "Default Company",
      email: "default@company.com",
      userId: "default-user"
    },
    user: {
      userInfo: {}
    },
    history: [],
    servicebooked: false,
    confirmEmailsent: false,
    createdAt: new Date().toISOString()
  };
}

// Session Repository
class SessionRepository {
  constructor(private readonly redis: Redis) {}

  async load(callSid: string): Promise<CallSkeleton | null> {
    try {
      const raw: string | null = await this.redis.get(this.key(callSid));
      return raw !== null ? (JSON.parse(raw) as CallSkeleton) : null;
    } catch (error) {
      console.error('Redis load error:', error);
      throw error;
    }
  }

  async create(callSid: string): Promise<CallSkeleton> {
    try {
      const skeleton = createEmptySkeleton(callSid);
      await this.redis.set(
        this.key(callSid),
        JSON.stringify(skeleton),
        'EX',
        SESSION_TTL,
      );
      return skeleton;
    } catch (error) {
      console.error('Redis create error:', error);
      throw error;
    }
  }

  async save(session: CallSkeleton): Promise<void> {
    try {
      await this.redis.set(
        this.key(session.callSid),
        JSON.stringify(session),
        'EX',
        SESSION_TTL,
      );
    } catch (error) {
      console.error('Redis save error:', error);
      throw error;
    }
  }

  async delete(callSid: string): Promise<void> {
    try {
      await this.redis.del(this.key(callSid));
    } catch (error) {
      console.error('Redis delete error:', error);
      throw error;
    }
  }

  async appendHistory(callSid: string, entry: Message): Promise<void> {
    const session = await this.load(callSid);
    if (!session) {
      throw new Error(`Session not found: ${callSid}`);
    }

    session.history.push(entry);
    await this.save(session);
  }

  private key(callSid: string): string {
    return getSessionKey(callSid);
  }
}

// Initialize session repository
const sessionRepo = new SessionRepository(redis);

// Initialize MCP Server with tools
function initSessionServer(): McpServer {
  const server = new McpServer({
    name: 'session-management-server',
    version: '0.1.0',
  });

  // Register session tools
  registerSessionTools(server);

  return server;
}

function registerSessionTools(server: McpServer) {
  // session.get tool
  server.tool(
    'session.get',
    'Get a session by callSid',
    {
      type: 'object',
      properties: {
        callSid: {
          type: 'string',
          description: 'The call session ID',
        },
      },
      required: ['callSid'],
    },
    async ({ callSid }) => {
      const session = await sessionRepo.load(callSid as string);

      if (!session) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Session not found', callSid })
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(session)
        }],
      };
    }
  );

  // session.create tool
  server.tool(
    'session.create',
    'Create a new session with the given callSid',
    {
      type: 'object',
      properties: {
        callSid: {
          type: 'string',
          description: 'The call session ID',
        },
      },
      required: ['callSid'],
    },
    async ({ callSid }) => {
      const existingSession = await sessionRepo.load(callSid as string);

      if (existingSession) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(existingSession)
          }],
        };
      }

      const newSession = await sessionRepo.create(callSid as string);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(newSession)
        }],
      };
    }
  );

  // session.patch tool
  server.tool(
    'session.patch',
    'Patch update specific fields in a session',
    {
      type: 'object',
      properties: {
        callSid: {
          type: 'string',
          description: 'The call session ID',
        },
        updates: {
          type: 'object',
          description: 'The fields to update (JSON patch format)',
        },
      },
      required: ['callSid', 'updates'],
    },
    async ({ callSid, updates }) => {
      let session = await sessionRepo.load(callSid as string);

      if (!session) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Session not found', callSid })
          }],
        };
      }

      // Apply updates to the session object
      for (const [path, value] of Object.entries(updates as Record<string, any>)) {
        const keys = path.split('.');
        let current: any = session;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) {
            current[keys[i]] = {};
          }
          current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
      }

      await sessionRepo.save(session);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(session)
        }],
      };
    }
  );

  // session.append_messages tool
  server.tool(
    'session.append_messages',
    'Append messages to session history',
    {
      type: 'object',
      properties: {
        callSid: {
          type: 'string',
          description: 'The call session ID',
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              speaker: {
                type: 'string',
                enum: ['AI', 'customer'],
              },
              message: {
                type: 'string',
              },
              startedAt: {
                type: 'string',
              },
            },
            required: ['speaker', 'message', 'startedAt'],
          },
          description: 'The messages to append',
        },
      },
      required: ['callSid', 'messages'],
    },
    async ({ callSid, messages }) => {
      const session = await sessionRepo.load(callSid as string);

      if (!session) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Session not found', callSid })
          }],
        };
      }

      // Append messages to history
      for (const message of messages as Message[]) {
        await sessionRepo.appendHistory(callSid as string, message);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, appended: (messages as Message[]).length })
        }],
      };
    }
  );

  // session.touch tool
  server.tool(
    'session.touch',
    'Update the last active timestamp of a session (uses createdAt field)',
    {
      type: 'object',
      properties: {
        callSid: {
          type: 'string',
          description: 'The call session ID',
        },
      },
      required: ['callSid'],
    },
    async ({ callSid }) => {
      const session = await sessionRepo.load(callSid as string);

      if (!session) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Session not found', callSid })
          }],
        };
      }

      // Note: Using createdAt as last active timestamp since we cannot modify CallSkeleton interface
      session.createdAt = new Date().toISOString();
      await sessionRepo.save(session);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, timestamp: Date.now() })
        }],
      };
    }
  );
}

// Create MCP Router (core MCP implementation)
function createMCPRouter(): Router {
  const router: Router = Router();

  // Session management - each session has independent server and transport
  const sessions = new Map<string, {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  }>();

  router.post("/", async (req, res) => {
    const sid = req.headers["mcp-session-id"];

    let transport: StreamableHTTPServerTransport;
    let server: McpServer;

    if (sid && typeof sid === "string") {
      // Existing session - get from Map
      const session = sessions.get(sid);

      const sessionNotFoundResponse: JSONRPCError = {
        jsonrpc: "2.0",
        id: req.body?.id ?? null,
        error: {
          code: -32000,
          message: "❌ Bad Request: Session not found",
        },
      };

      if (!session) {
        res.status(404).json(sessionNotFoundResponse);
        return;
      }

      server = session.server;
      transport = session.transport;

    } else if (!sid && isInitializeRequest(req.body)) {
      // New session - create transport and server
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, {
            transport,
            server,
          });
          console.log(`⭐️ New session initialized: ${sessionId}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`❌ Closing session: ${transport.sessionId}`);
          sessions.delete(transport.sessionId);
        }
      };

      server = initSessionServer();
      await server.connect(transport);

    } else {
      const badRequestResponse: JSONRPCError = {
        jsonrpc: "2.0",
        id: req.body?.id ?? null,
        error: {
          code: -32000,
          message: "❌ Bad Request: Invalid request",
        },
      };

      res.status(400).json(badRequestResponse);
      return;
    }

    // 🎯 Key: Use transport to handle HTTP request
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}

// Create health check router
function createHealthCheckRouter(): Router {
  const router: Router = Router();

  router.get("/", (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'mcp-session-server'
    });
  });

  return router;
}

// Create root router
function createRootRouter(): Router {
  const rootRouter: Router = Router();

  const healthCheckRouter = createHealthCheckRouter();
  const mcpRouter = createMCPRouter();

  rootRouter.use("/health", healthCheckRouter);
  rootRouter.use("/mcp", mcpRouter);

  return rootRouter;
}

// Main server startup
async function startMCPServer() {
  const transportType = process.env.MCP_TRANSPORT || 'http';
  const port = parseInt(process.env.PORT || '3000');

  if (transportType === "stdio") {
    console.log('Starting MCP server with stdio transport...');
    const server = initSessionServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.log(`stdio MCP Session Server initialized`);
    return server;

  } else if (transportType === "http") {
    console.log(`Starting MCP server with HTTP transport on port ${port}...`);

    const app = express();
    app.use(cors());
    app.use(express.json());

    // Root router
    const rootRouter = createRootRouter();
    app.use("/", rootRouter);

    app.listen(port, () => {
      console.log(`MCP Session Server running on HTTP port ${port}`);
      console.log(`END POINT: http://localhost:${port}/mcp`);
      console.log(`HEALTH CHECK: http://localhost:${port}/health`);
    });

  } else {
    throw new Error(`Invalid transport: ${transportType}`);
  }

  return {
    close: () => {},
  };
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down MCP server...');
  await redis.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down MCP server...');
  await redis.disconnect();
  process.exit(0);
});

// Start the server
(async () => {
  try {
    await startMCPServer();
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
})();