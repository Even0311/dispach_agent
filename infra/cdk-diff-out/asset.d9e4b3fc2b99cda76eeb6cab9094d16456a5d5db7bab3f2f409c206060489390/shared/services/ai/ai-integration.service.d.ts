export declare class AiIntegrationService {
    private http;
    constructor();
    getAIReply(callSid: string, message: string): Promise<{
        message: string;
        shouldHangup?: boolean;
    }>;
    generateAISummary(callSid: string, conversation: any[], serviceInfo: any): Promise<{
        summary: string;
        keyPoints: string[];
    }>;
}
//# sourceMappingURL=ai-integration.service.d.ts.map