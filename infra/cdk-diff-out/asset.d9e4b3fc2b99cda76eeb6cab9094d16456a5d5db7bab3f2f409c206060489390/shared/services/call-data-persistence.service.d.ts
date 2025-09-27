import { VoiceStatusBody } from '../types';
export declare class CallDataPersistenceService {
    private sessions;
    private callLogService;
    private transcriptService;
    private transcriptChunkService;
    private serviceBookingService;
    private aiSummaryService;
    private emailCalendarService;
    constructor();
    processCallCompletion(callSid: string, twilioParams: VoiceStatusBody): Promise<void>;
    private generateAISummaryForSession;
    private createCallLogRecord;
    private createTranscriptAndChunks;
    private createServiceBookingRecord;
    private sendEmailAndCalendar;
}
//# sourceMappingURL=call-data-persistence.service.d.ts.map