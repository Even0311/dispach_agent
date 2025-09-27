"use strict";
/**
 * Data Transformer Helper
 *
 * Pure utility functions for transforming data between different formats.
 * Used for converting between internal data structures and external APIs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataTransformerHelper = void 0;
exports.DataTransformerHelper = {
    /**
     * Convert conversation messages to transcript chunks format
     */
    convertMessagesToChunks(messages) {
        return messages.map((msg, index) => ({
            speakerType: msg.speaker === 'AI' ? 'AI' : 'User',
            text: msg.message,
            startAt: new Date(msg.startedAt).getTime() + index, // Ensure uniqueness
        }));
    },
    /**
     * Convert session messages to AI conversation format
     */
    convertToAIConversationFormat(messages) {
        return messages.map(msg => ({
            speaker: msg.speaker === 'AI' ? 'AI' : 'customer',
            message: msg.message,
            timestamp: msg.startedAt,
        }));
    },
    /**
     * Clean and validate AI summary response
     */
    cleanAISummaryResponse(aiSummary) {
        const summary = aiSummary != null &&
            typeof aiSummary === 'object' &&
            'summary' in aiSummary
            ? aiSummary.summary
            : undefined;
        const keyPoints = aiSummary != null &&
            typeof aiSummary === 'object' &&
            'keyPoints' in aiSummary
            ? aiSummary.keyPoints
            : undefined;
        return {
            summary: typeof summary === 'string' ? summary : 'Call summary not available',
            keyPoints: Array.isArray(keyPoints) ? keyPoints : [],
        };
    },
    /**
     * Extract service info for AI analysis
     */
    extractServiceInfoForAI(session) {
        // Safely extract user service name
        const userServiceName = session.user.service?.name;
        // Safely extract services array name
        const firstServiceName = session.services.length > 0 ? session.services[0].name : undefined;
        // Company name
        const companyName = session.company.name || 'Unknown';
        return {
            name: userServiceName ?? firstServiceName ?? 'general inquiry',
            booked: session.servicebooked,
            company: companyName,
        };
    },
    /**
     * Build customer message for AI API
     */
    buildCustomerMessageForAI(message) {
        return {
            speaker: 'customer',
            message,
            startedAt: new Date().toISOString(),
        };
    },
};
//# sourceMappingURL=data-transformer.helper.js.map