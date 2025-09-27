/**
 * Data Transformer Helper
 *
 * Pure utility functions for transforming data between different formats.
 * Used for converting between internal data structures and external APIs.
 */
import type { Message, CallSkeleton } from '../types';
export declare const DataTransformerHelper: {
    /**
     * Convert conversation messages to transcript chunks format
     */
    readonly convertMessagesToChunks: (messages: Message[]) => {
        speakerType: "AI" | "User";
        text: string;
        startAt: number;
    }[];
    /**
     * Convert session messages to AI conversation format
     */
    readonly convertToAIConversationFormat: (messages: Message[]) => {
        speaker: "AI" | "customer";
        message: string;
        timestamp: string;
    }[];
    /**
     * Clean and validate AI summary response
     */
    readonly cleanAISummaryResponse: (aiSummary: unknown) => {
        summary: string;
        keyPoints: string[];
    };
    /**
     * Extract service info for AI analysis
     */
    readonly extractServiceInfoForAI: (session: CallSkeleton) => {
        name: string;
        booked: boolean;
        company: string;
    };
    /**
     * Build customer message for AI API
     */
    readonly buildCustomerMessageForAI: (message: string) => {
        speaker: string;
        message: string;
        startedAt: string;
    };
};
//# sourceMappingURL=data-transformer.helper.d.ts.map