"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const call_processor_service_1 = require("../shared/services/call-processor.service");
const callProcessor = new call_processor_service_1.CallProcessorService();
const handler = async (event) => {
    try {
        console.log('[GatherHandler] Processing gather webhook:', JSON.stringify(event));
        // Parse the request body
        let body;
        try {
            if (!event.body) {
                throw new Error('No request body provided');
            }
            // Handle Base64 encoded body from Lambda Function URL
            const rawBody = event.isBase64Encoded
                ? Buffer.from(event.body, 'base64').toString('utf-8')
                : event.body;
            // Parse form-urlencoded data from Twilio
            const urlParams = new URLSearchParams(rawBody);
            body = Object.fromEntries(urlParams.entries());
            console.log('[GatherHandler] Parsed request body:', body);
        }
        catch (error) {
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
    }
    catch (error) {
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
exports.handler = handler;
//# sourceMappingURL=index.js.map