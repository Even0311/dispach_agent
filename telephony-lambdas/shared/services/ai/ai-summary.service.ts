import { CallSkeleton } from '../../types';
import { DataTransformerHelper } from '../../helpers';
import { AiIntegrationService } from './ai-integration.service';

export interface SummaryOptions {
  enableFallback?: boolean;
  fallbackSummary?: string;
  fallbackKeyPoints?: string[];
}

export class AiSummaryService {
  private aiIntegration: AiIntegrationService;

  constructor() {
    this.aiIntegration = new AiIntegrationService();
  }

  async generateSummary(
    callSid: string,
    session: CallSkeleton,
    options: SummaryOptions = {}
  ): Promise<{ summary: string; keyPoints: string[] }> {
    try {
      // Prepare conversation data for AI analysis
      const conversation = DataTransformerHelper.convertToAIConversationFormat(
        session.history,
      );

      // Prepare service information
      const serviceInfo = DataTransformerHelper.extractServiceInfoForAI(session);

      return await this.aiIntegration.generateAISummary(
        callSid,
        conversation,
        serviceInfo
      );

    } catch (error) {
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