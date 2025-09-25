import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { GeneralServiceReactAgent } from './agent';
import { AgentRequest, AgentResponse } from './types';

// Initialize agent instance (reuse across warm starts)
let agentInstance: GeneralServiceReactAgent | null = null;

const initializeAgent = async (): Promise<GeneralServiceReactAgent> => {
  if (!agentInstance) {
    console.log('Initializing ElectricianReactAgent...');
    agentInstance = new GeneralServiceReactAgent();

    // Test connection on first initialization
    const isConnected = await agentInstance.testConnection();
    console.log(`Agent connection test: ${isConnected ? 'SUCCESS' : 'FAILED'}`);

    if (!isConnected) {
      console.warn('Agent connection test failed, but proceeding...');
    }
  }
  return agentInstance;
};

const createResponse = (
  statusCode: number,
  body: any,
  headers?: Record<string, string>
): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers,
    },
    body: JSON.stringify(body),
  };
};

const validateRequest = (body: any): AgentRequest | null => {
  if (!body) {
    return null;
  }

  if (!body.query || typeof body.query !== 'string') {
    return null;
  }

  if (body.query.trim().length === 0) {
    return null;
  }

  return {
    query: body.query.trim(),
    session_id: body.session_id || undefined,
  };
};

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const requestId = context.awsRequestId;
  const startTime = Date.now();

  console.log(`[${requestId}] Processing request`, {
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
  });

  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return createResponse(200, { message: 'OK' });
    }

    // Handle health check
    if (event.httpMethod === 'GET' && event.path === '/health') {
      const agent = await initializeAgent();
      const agentInfo = agent.getAgentInfo();

      return createResponse(200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        agent: agentInfo,
        request_id: requestId,
      });
    }

    // Handle agent requests
    if (event.httpMethod === 'POST') {
      let body: any;

      try {
        body = event.body ? JSON.parse(event.body) : null;
      } catch (parseError) {
        console.error(`[${requestId}] JSON parse error:`, parseError);
        return createResponse(400, {
          error: 'Invalid JSON in request body',
          request_id: requestId,
        });
      }

      const agentRequest = validateRequest(body);
      if (!agentRequest) {
        return createResponse(400, {
          error: 'Invalid request. Required: { "query": "your question here" }',
          request_id: requestId,
        });
      }

      console.log(`[${requestId}] Processing query:`, agentRequest.query);

      // Initialize and execute agent
      const agent = await initializeAgent();
      const result: AgentResponse = await agent.execute(agentRequest);

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`[${requestId}] Agent execution completed`, {
        execution_time: result.execution_time,
        total_processing_time: `${processingTime}s`,
        steps_count: result.steps.length,
        session_id: result.session_id,
      });

      return createResponse(200, {
        ...result,
        request_id: requestId,
        processing_time: `${processingTime}s`,
      });
    }

    // Handle unsupported methods
    return createResponse(405, {
      error: 'Method not allowed',
      allowed_methods: ['GET', 'POST', 'OPTIONS'],
      request_id: requestId,
    });

  } catch (error) {
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const err = error as Error;
    console.error(`[${requestId}] Unhandled error:`, {
      error: err.message,
      stack: err.stack,
      processing_time: `${processingTime}s`,
    });

    return createResponse(500, {
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing your request.',
      request_id: requestId,
      processing_time: `${processingTime}s`,
      // Include error details in development
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          error: err.message,
          stack: err.stack,
        },
      }),
    });
  }
};

// Export for local testing
export { GeneralServiceReactAgent } from './agent';
export * from './types';