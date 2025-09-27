/**
 * Validation Helper
 *
 * Pure utility functions for validating call data and business logic.
 * Contains validation rules and business logic checks.
 */
import type { CallSkeleton } from '../types';
export declare const ValidationHelper: {
    /**
     * Check if call status is final (completed or canceled)
     */
    readonly isFinalCallStatus: (status: string) => boolean;
    /**
     * Validate if session has required data for service booking
     */
    readonly canCreateServiceBooking: (session: CallSkeleton) => {
        isValid: boolean;
        missingFields: string[];
    };
    /**
     * Check if session should be processed for completion
     */
    readonly shouldProcessSession: (session: CallSkeleton | null) => boolean;
    /**
     * Validate AI response data
     */
    readonly isValidAIResponse: (response: unknown) => boolean;
    /**
     * Check if service is available for booking
     */
    readonly isServiceAvailable: (session: CallSkeleton) => boolean;
    /**
     * Validate customer address format
     */
    readonly isValidAddress: (address: string | undefined) => boolean;
    /**
     * Extract fallback address if primary address is invalid
     */
    readonly getFallbackAddress: (address: string | undefined) => string;
    /**
     * Validate transcript data before saving
     */
    readonly validateTranscriptData: (data: {
        summary?: string;
        keyPoints?: string[];
    }) => {
        summary: string;
        keyPoints: string[];
    };
};
//# sourceMappingURL=validation.helper.d.ts.map