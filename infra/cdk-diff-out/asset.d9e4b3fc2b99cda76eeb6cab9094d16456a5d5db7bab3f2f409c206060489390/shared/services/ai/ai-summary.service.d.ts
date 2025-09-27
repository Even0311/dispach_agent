import { CallSkeleton } from '../../types';
export interface SummaryOptions {
    enableFallback?: boolean;
    fallbackSummary?: string;
    fallbackKeyPoints?: string[];
}
export declare class AiSummaryService {
    private aiIntegration;
    constructor();
    generateSummary(callSid: string, session: CallSkeleton, options?: SummaryOptions): Promise<{
        summary: string;
        keyPoints: string[];
    }>;
}
//# sourceMappingURL=ai-summary.service.d.ts.map