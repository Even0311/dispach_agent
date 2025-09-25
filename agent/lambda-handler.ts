import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { GeneralServiceReactAgent } from './src/react-agent/agent';
import { AgentRequest, AgentResponse } from './src/react-agent/types';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Initialize AWS services
const ssmClient = new SSMClient({ region: process.env.BEDROCK_AWS_REGION || 'ap-southeast-2' });

// Initialize agent instance (reuse across warm starts)
let agentInstance: GeneralServiceReactAgent | null = null;
let langsmithApiKey: string | null = null;

/**
 * Retrieve LangSmith API key from Parameter Store
 */
const getLangSmithApiKey = async (): Promise<string | null> => {
  if (langsmithApiKey) {
    return langsmithApiKey;
  }

  try {
    const paramName = process.env.LANGSMITH_API_KEY_PARAM;
    if (!paramName) {
      console.warn('LANGSMITH_API_KEY_PARAM environment variable not set');
      return null;
    }

    const command = new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    });

    const result = await ssmClient.send(command);

    langsmithApiKey = result.Parameter?.Value || null;

    if (langsmithApiKey) {
      // Set the environment variable for LangSmith
      process.env.LANGCHAIN_API_KEY = langsmithApiKey;
      console.log('LangSmith API key retrieved and set successfully');
    } else {
      console.warn('LangSmith API key not found in Parameter Store');
    }

    return langsmithApiKey;
  } catch (error) {
    console.error('Error retrieving LangSmith API key from Parameter Store:', error);
    return null;
  }
};

/**
 * Initialize the agent with proper error handling and configuration
 */
const initializeAgent = async (): Promise<GeneralServiceReactAgent> => {
  if (!agentInstance) {
    console.log('Initializing GeneralServiceReactAgent...');

    try {
      // Retrieve LangSmith API key
      await getLangSmithApiKey();

      // Create agent instance
      agentInstance = new GeneralServiceReactAgent();

      // Test connection on first initialization
      const isConnected = await agentInstance.testConnection();
      console.log(`Agent connection test: ${isConnected ? 'SUCCESS' : 'FAILED'}`);

      if (!isConnected) {
        console.warn('Agent connection test failed, but proceeding...');
      }

      console.log('GeneralServiceReactAgent initialized successfully');
    } catch (error) {
      console.error('Error initializing GeneralServiceReactAgent:', error);
      throw error;
    }
  }
  return agentInstance;
};

/**
 * Create HTTP response with proper headers
 */
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID, X-Session-ID',
      'Access-Control-Max-Age': '300',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      ...headers,
    },
    body: JSON.stringify(body),
  };
};

/**
 * Validate incoming agent request
 */
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

  // Validate session_id if provided
  if (body.session_id && typeof body.session_id !== 'string') {
    return null;
  }

  return {
    query: body.query.trim(),
    session_id: body.session_id || undefined,
  };
};

/**
 * Main Lambda handler
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const requestId = context.awsRequestId;
  const startTime = Date.now();

  // Set correlation ID for tracing
  process.env.AWS_REQUEST_ID = requestId;

  console.log(`[${requestId}] Processing request`, {
    httpMethod: event.httpMethod,
    path: event.path,
    userAgent: event.headers['User-Agent'],
    sourceIp: event.requestContext.identity.sourceIp,
    remainingTimeInMillis: context.getRemainingTimeInMillis(),
  });

  try {
    // Handle CORS preflight requests
    if (event.httpMethod === 'OPTIONS') {
      console.log(`[${requestId}] Handling CORS preflight request`);
      return createResponse(200, { message: 'CORS preflight successful' });
    }

    // Handle health check requests
    if (event.httpMethod === 'GET' && (event.path === '/health' || event.path === '/')) {
      console.log(`[${requestId}] Handling health check request`);

      try {
        const agent = await initializeAgent();
        const agentInfo = agent.getAgentInfo();

        return createResponse(200, {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          agent: agentInfo,
          request_id: requestId,
          environment: {
            nodejs_version: process.version,
            region: process.env.BEDROCK_AWS_REGION,
            memory_limit: context.memoryLimitInMB,
            remaining_time: context.getRemainingTimeInMillis(),
          },
        });
      } catch (error) {
        console.error(`[${requestId}] Health check failed:`, error);
        return createResponse(503, {
          status: 'unhealthy',
          error: 'Agent initialization failed',
          request_id: requestId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Handle agent query requests
    if (event.httpMethod === 'POST') {
      let body: any;

      try {
        body = event.body ? JSON.parse(event.body) : null;
      } catch (parseError) {
        console.error(`[${requestId}] JSON parse error:`, parseError);
        return createResponse(400, {
          error: 'Invalid JSON in request body',
          message: 'Request body must be valid JSON',
          request_id: requestId,
        });
      }

      const agentRequest = validateRequest(body);
      if (!agentRequest) {
        console.warn(`[${requestId}] Invalid request format:`, body);
        return createResponse(400, {
          error: 'Invalid request format',
          message: 'Required: { "query": "your question here", "session_id": "optional" }',
          request_id: requestId,
        });
      }

      console.log(`[${requestId}] Processing agent query:`, {
        query_length: agentRequest.query.length,
        session_id: agentRequest.session_id || 'none',
        remaining_time: context.getRemainingTimeInMillis(),
      });

      // Initialize and execute agent
      try {
        const agent = await initializeAgent();
        const result: AgentResponse = await agent.execute(agentRequest);

        const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`[${requestId}] Agent execution completed successfully`, {
          execution_time: result.execution_time,
          total_processing_time: `${processingTime}s`,
          steps_count: result.steps.length,
          session_id: result.session_id,
          remaining_time: context.getRemainingTimeInMillis(),
        });

        return createResponse(200, {
          ...result,
          request_id: requestId,
          processing_time: `${processingTime}s`,
          timestamp: new Date().toISOString(),
        });

      } catch (agentError) {
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[${requestId}] Agent execution error:`, agentError);

        const err = agentError as Error;
        return createResponse(500, {
          error: 'Agent execution failed',
          message: 'The agent encountered an error while processing your request. Please try again or contact support.',
          request_id: requestId,
          processing_time: `${processingTime}s`,
          timestamp: new Date().toISOString(),
          // Include error details in non-production environments
          ...(process.env.NODE_ENV !== 'production' && {
            debug: {
              error: err.message,
              stack: err.stack,
            },
          }),
        });
      }
    }

    // Handle unsupported HTTP methods
    console.warn(`[${requestId}] Unsupported HTTP method: ${event.httpMethod}`);
    return createResponse(405, {
      error: 'Method not allowed',
      message: `HTTP method ${event.httpMethod} is not supported`,
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
      remaining_time: context.getRemainingTimeInMillis(),
    });

    return createResponse(500, {
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing your request.',
      request_id: requestId,
      processing_time: `${processingTime}s`,
      timestamp: new Date().toISOString(),
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

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  // Clean up resources if needed
  agentInstance = null;
  langsmithApiKey = null;
});

// Export for local testing
export { GeneralServiceReactAgent } from './src/react-agent/agent';
export * from './src/react-agent/types';