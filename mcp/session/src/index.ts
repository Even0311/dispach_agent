#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import express from 'express';
import cors from 'cors';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';
import Redis from 'ioredis';
import { CallSkeleton, Service, Message } from '@dispatch-agent/types';

const server = new Server(
  {
    name: 'mcp-session-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Redis client with RedisJSON support
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

// Session Repository class matching their pattern
class SessionRepository {
  constructor(private readonly redis: Redis) {}

  async load(callSid: string): Promise<CallSkeleton | null> {
    const raw: string | null = await this.redis.get(this.key(callSid));
    return raw !== null ? (JSON.parse(raw) as CallSkeleton) : null;
  }

  async create(callSid: string): Promise<CallSkeleton> {
    const skeleton = createEmptySkeleton(callSid);
    await this.redis.set(
      this.key(callSid),
      JSON.stringify(skeleton),
      'EX',
      SESSION_TTL,
    );
    return skeleton;
  }

  async save(session: CallSkeleton): Promise<void> {
    await this.redis.set(
      this.key(session.callSid),
      JSON.stringify(session),
      'EX',
      SESSION_TTL,
    );
  }

  async delete(callSid: string): Promise<void> {
    await this.redis.del(this.key(callSid));
  }

  async appendHistory(callSid: string, entry: Message): Promise<void> {
    const session = await this.load(callSid);
    if (!session) return;

    session.history.push(entry);
    await this.save(session);
  }

  async appendServices(callSid: string, services: Service[]): Promise<void> {
    const session = await this.load(callSid);
    if (!session) return;
    session.services = services;
    await this.save(session);
  }

  private key(callSid: string): string {
    return getSessionKey(callSid);
  }
}

// Initialize session repository
const sessionRepo = new SessionRepository(redis);

// Tool definitions
const tools: Tool[] = [
  {
    name: 'session.get',
    description: 'Get a session by callSid',
    inputSchema: {
      type: 'object',
      properties: {
        callSid: {
          type: 'string',
          description: 'The call session ID',
        },
      },
      required: ['callSid'],
    },
  },
  {
    name: 'session.patch',
    description: 'Patch update specific fields in a session',
    inputSchema: {
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
  },
  {
    name: 'session.append_messages',
    description: 'Append messages to session history',
    inputSchema: {
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
  },
  {
    name: 'session.touch',
    description: 'Update the last active timestamp of a session',
    inputSchema: {
      type: 'object',
      properties: {
        callSid: {
          type: 'string',
          description: 'The call session ID',
        },
      },
      required: ['callSid'],
    },
  },
];

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: CallToolResult;

    switch (name) {
      case 'session.get': {
        const { callSid } = args as { callSid: string };
        const session = await sessionRepo.load(callSid);

        if (!session) {
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Session not found', callSid })
            } as TextContent],
          };
        } else {
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify(session)
            } as TextContent],
          };
        }
        break;
      }

      case 'session.patch': {
        const { callSid, updates } = args as { callSid: string; updates: Record<string, any> };
        let session = await sessionRepo.load(callSid);

        if (!session) {
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Session not found', callSid })
            } as TextContent],
          };
          break;
        }

        // Apply updates to the session object
        for (const [path, value] of Object.entries(updates)) {
          // Simple dot notation path handling
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

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify(session)
          } as TextContent],
        };
        break;
      }

      case 'session.append_messages': {
        const { callSid, messages } = args as {
          callSid: string;
          messages: Array<{ speaker: 'AI' | 'customer'; message: string; startedAt: string }>
        };

        const session = await sessionRepo.load(callSid);
        if (!session) {
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Session not found', callSid })
            } as TextContent],
          };
          break;
        }

        // Append messages to history
        for (const message of messages) {
          await sessionRepo.appendHistory(callSid, message);
        }

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, appended: messages.length })
          } as TextContent],
        };
        break;
      }

      case 'session.touch': {
        const { callSid } = args as { callSid: string };
        const session = await sessionRepo.load(callSid);

        if (!session) {
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Session not found', callSid })
            } as TextContent],
          };
          break;
        }

        // Update timestamp and save
        session.createdAt = new Date().toISOString();
        await sessionRepo.save(session);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, timestamp: Date.now() })
          } as TextContent],
        };
        break;
      }

      default:
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Unknown tool: ${name}` })
          } as TextContent],
          isError: true,
        };
    }

    return result;
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: `Tool execution failed: ${error}` })
      } as TextContent],
      isError: true,
    };
  }
});

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// MCP endpoints
app.post('/mcp/tools', async (req, res) => {
  try {
    const result = { tools };
    res.json(result);
  } catch (error) {
    console.error('Error listing tools:', error);
    res.status(500).json({ error: 'Failed to list tools' });
  }
});

app.post('/mcp/tools/:toolName', async (req, res) => {
  try {
    const { toolName } = req.params;
    const { arguments: args } = req.body;

    // Manually handle tool calls instead of using server.request
    let result: CallToolResult;

    switch (toolName) {
      case 'session.get': {
        const { callSid } = args as { callSid: string };
        const key = getSessionKey(callSid);
        const sessionData = await redis.call('JSON.GET', key) as string;

        if (!sessionData) {
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Session not found', callSid })
            } as TextContent],
          };
        } else {
          const session: CallSkeleton = JSON.parse(sessionData);
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify(session)
            } as TextContent],
          };
        }
        break;
      }

      default:
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Unknown tool: ${toolName}` })
          } as TextContent],
          isError: true,
        };
    }

    res.json(result);
  } catch (error) {
    console.error(`Error calling tool ${req.params.toolName}:`, error);
    res.status(500).json({ error: `Failed to call tool ${req.params.toolName}` });
  }
});

// Session-specific endpoints for easier HTTP access
app.get('/session/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    const session = await sessionRepo.load(callSid);

    if (!session) {
      return res.status(404).json({ error: 'Session not found', callSid });
    }

    res.json(session);
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

app.patch('/session/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    const { updates } = req.body;
    let session = await sessionRepo.load(callSid);

    if (!session) {
      return res.status(404).json({ error: 'Session not found', callSid });
    }

    // Apply updates to the session object
    for (const [path, value] of Object.entries(updates)) {
      // Simple dot notation path handling
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
    res.json(session);
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

app.post('/session/:callSid/messages', async (req, res) => {
  try {
    const { callSid } = req.params;
    const { messages } = req.body;
    const session = await sessionRepo.load(callSid);

    if (!session) {
      return res.status(404).json({ error: 'Session not found', callSid });
    }

    // Append messages to history
    for (const message of messages) {
      await sessionRepo.appendHistory(callSid, message);
    }

    res.json({ success: true, appended: messages.length });
  } catch (error) {
    console.error('Error appending messages:', error);
    res.status(500).json({ error: 'Failed to append messages' });
  }
});

app.post('/session/:callSid/touch', async (req, res) => {
  try {
    const { callSid } = req.params;
    const session = await sessionRepo.load(callSid);

    if (!session) {
      return res.status(404).json({ error: 'Session not found', callSid });
    }

    // Update timestamp and save
    session.createdAt = new Date().toISOString();
    await sessionRepo.save(session);

    res.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('Error touching session:', error);
    res.status(500).json({ error: 'Failed to touch session' });
  }
});

// Add session creation endpoint to match their pattern
app.post('/session/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    const existingSession = await sessionRepo.load(callSid);

    if (existingSession) {
      return res.json(existingSession);
    }

    const newSession = await sessionRepo.create(callSid);
    res.status(201).json(newSession);
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Add session deletion endpoint
app.delete('/session/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    await sessionRepo.delete(callSid);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Keep existing MCP endpoints for compatibility (using standard HTTP)
// These are already implemented above in the Session-specific endpoints section

// Start the server
async function main() {
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`MCP Session Server running on HTTP port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`Session API endpoints available at: http://localhost:${port}/session/`);
  });
}

main().catch(console.error);