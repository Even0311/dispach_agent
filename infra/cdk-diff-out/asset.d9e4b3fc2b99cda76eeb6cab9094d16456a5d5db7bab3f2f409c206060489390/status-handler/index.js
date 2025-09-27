"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const call_processor_service_1 = require("../shared/services/call-processor.service");
const callProcessor = new call_processor_service_1.CallProcessorService();
const handler = async (event) => {
    try {
        console.log('[StatusHandler] Processing status webhook:', JSON.stringify(event));
        // Parse the request body
        let body;
        try {
            body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        }
        catch (error) {
            console.error('[StatusHandler] Failed to parse request body:', error);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid request body' }),
            };
        }
        // Validate required fields
        if (!body.CallSid || !body.CallStatus) {
            console.error('[StatusHandler] Missing required fields:', body);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields' }),
            };
        }
        // Process the status callback
        await callProcessor.handleStatus(body);
        console.log(`[StatusHandler] Successfully processed status ${body.CallStatus} for call ${body.CallSid}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Status processed successfully' }),
        };
    }
    catch (error) {
        console.error('[StatusHandler] Error processing status webhook:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' }),
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=index.js.map