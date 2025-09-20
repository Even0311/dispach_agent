import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { VoiceGatherBody } from '../shared/types';
import { CallProcessorService } from '../shared/services/call-processor.service';

const callProcessor = new CallProcessorService();

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('[GatherHandler] Processing gather webhook:', JSON.stringify(event));

    // Parse the request body
    let body: VoiceGatherBody;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (error) {
      console.error('[GatherHandler] Failed to parse request body:', error);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'text/xml',
        },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid request</Say><Hangup/></Response>',
      };
    }

    // Validate required fields
    if (!body.CallSid) {
      console.error('[GatherHandler] Missing CallSid:', body);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'text/xml',
        },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid request parameters</Say><Hangup/></Response>',
      };
    }

    // Process the gather request
    const twimlResponse = await callProcessor.handleGather(body);

    console.log('[GatherHandler] Generated TwiML response:', twimlResponse);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
      body: twimlResponse,
    };

  } catch (error) {
    console.error('[GatherHandler] Error processing gather webhook:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'text/xml',
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>System error occurred</Say><Hangup/></Response>',
    };
  }
};