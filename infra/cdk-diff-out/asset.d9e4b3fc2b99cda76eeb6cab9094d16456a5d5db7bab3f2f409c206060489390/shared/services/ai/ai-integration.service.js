"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiIntegrationService = void 0;
const axios_1 = __importDefault(require("axios"));
const AI_TIMEOUT_MS = 5000;
const AI_RETRY = 2;
class AiIntegrationService {
    constructor() {
        this.http = axios_1.default.create({
            timeout: AI_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        // Add retry logic
        this.http.interceptors.response.use((response) => response, async (error) => {
            const config = error.config;
            if (config && config.retryCount < AI_RETRY) {
                config.retryCount = config.retryCount ? config.retryCount + 1 : 1;
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
                return this.http.request(config);
            }
            return Promise.reject(error);
        });
    }
    async getAIReply(callSid, message) {
        // Hardcoded response for testing
        console.log(`[AiIntegrationService] Mock AI reply for CallSid: ${callSid}, Message: ${message}`);
        return {
            message: "Thank you for calling! I understand you need assistance. Can you please provide more details about your request so I can help you better?",
            shouldHangup: false
        };
    }
    async generateAISummary(callSid, conversation, serviceInfo) {
        try {
            const aiServiceUrl = process.env.AI_SERVICE_URL;
            if (!aiServiceUrl) {
                throw new Error('AI_SERVICE_URL not configured');
            }
            const requestData = {
                callSid,
                conversation,
                serviceInfo,
            };
            const response = await this.http.post(`${aiServiceUrl}/ai/summary`, requestData);
            console.log(`[AiIntegrationService] Generated AI summary for ${callSid}`);
            return response.data;
        }
        catch (error) {
            console.error(`[AiIntegrationService] Failed to generate AI summary for ${callSid}:`, error);
            throw error;
        }
    }
}
exports.AiIntegrationService = AiIntegrationService;
//# sourceMappingURL=ai-integration.service.js.map