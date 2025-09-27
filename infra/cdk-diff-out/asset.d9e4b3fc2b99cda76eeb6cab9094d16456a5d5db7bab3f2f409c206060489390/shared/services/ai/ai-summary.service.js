"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSummaryService = void 0;
const helpers_1 = require("../../helpers");
const ai_integration_service_1 = require("./ai-integration.service");
class AiSummaryService {
    constructor() {
        this.aiIntegration = new ai_integration_service_1.AiIntegrationService();
    }
    async generateSummary(callSid, session, options = {}) {
        try {
            // Prepare conversation data for AI analysis
            const conversation = helpers_1.DataTransformerHelper.convertToAIConversationFormat(session.history);
            // Prepare service information
            const serviceInfo = helpers_1.DataTransformerHelper.extractServiceInfoForAI(session);
            return await this.aiIntegration.generateAISummary(callSid, conversation, serviceInfo);
        }
        catch (error) {
            console.error(`[AiSummaryService] Failed to generate summary for ${callSid}:`, error);
            if (options.enableFallback) {
                return {
                    summary: options.fallbackSummary || 'Call summary generation failed',
                    keyPoints: options.fallbackKeyPoints || ['Summary could not be generated'],
                };
            }
            throw error;
        }
    }
}
exports.AiSummaryService = AiSummaryService;
//# sourceMappingURL=ai-summary.service.js.map