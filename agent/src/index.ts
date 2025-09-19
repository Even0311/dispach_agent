import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AssistRequest, AssistResponse } from '@dispatch-agent/types';
import { DispatchAgent } from './agent';
import { MCPSessionClient } from './mcp-client';

// Initialize the MCP client and agent
const mcpClient = new MCPSessionClient();
const agent = new DispatchAgent(mcpClient);

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Received request', { event });

    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body is required' }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      };
    }

    const request: AssistRequest = JSON.parse(event.body);

    // Validate required fields
    if (!request.callSid || !request.text) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'callSid and text are required' }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      };
    }

    console.info('Processing assist request', { callSid: request.callSid });

    // Process the request through the LangGraph agent
    const reply = await agent.processRequest(request);

    const response: AssistResponse = {
      reply,
    };

    return {
      statusCode: 200,
      body: JSON.stringify(response),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  } catch (error) {
    console.error('Error processing request', { error });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }
};