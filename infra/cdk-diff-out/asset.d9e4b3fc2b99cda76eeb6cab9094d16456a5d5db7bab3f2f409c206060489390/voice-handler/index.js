"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const call_processor_service_1 = require("../shared/services/call-processor.service");
const callProcessor = new call_processor_service_1.CallProcessorService();
const handler = async (event) => {
    try {
        console.log('[VoiceHandler] Processing voice webhook:', JSON.stringify(event));
        // Parse the request body (Twilio sends form-urlencoded data)
        let body;
        try {
            let rawBody = event.body;
            // Handle Base64 encoding if present
            if (event.isBase64Encoded && typeof rawBody === 'string') {
                rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
            }
            if (typeof rawBody === 'string') {
                // Parse form-urlencoded data
                const params = new URLSearchParams(rawBody);
                const rawEntries = Object.fromEntries(params.entries());
                // Clean up keys and values by trimming whitespace
                const cleanedEntries = {};
                for (const [key, value] of Object.entries(rawEntries)) {
                    cleanedEntries[key.trim()] = typeof value === 'string' ? value.trim() : value;
                }
                body = cleanedEntries;
            }
            else {
                body = rawBody;
            }
        }
        catch (error) {
            console.error('[VoiceHandler] Failed to parse request body:', error);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'text/xml',
                },
                body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid request</Say><Hangup/></Response>',
            };
        }
        // Validate required fields
        if (!body.CallSid || !body.To) {
            console.error('[VoiceHandler] Missing required fields:', body);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'text/xml',
                },
                body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid request parameters</Say><Hangup/></Response>',
            };
        }
        // Process the voice request
        const twimlResponse = await callProcessor.handleVoice(body);
        console.log('[VoiceHandler] Generated TwiML response:', twimlResponse);
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/xml',
            },
            body: twimlResponse,
        };
    }
    catch (error) {
        console.error('[VoiceHandler] Error processing voice webhook:', error);
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