import { VoiceGatherBody, VoiceStatusBody } from '../index';
export declare class CallProcessorService {
    private readonly statusHandlers;
    private readonly validCallStatuses;
    private sessionHelper;
    private userService;
    private serviceService;
    private companyService;
    private aiIntegration;
    private dataPersistence;
    constructor();
    handleVoice(voiceData: VoiceGatherBody): Promise<string>;
    handleGather({ CallSid, SpeechResult, }: VoiceGatherBody): Promise<string>;
    handleStatus(statusData: VoiceStatusBody): Promise<void>;
    private handleCompletedStatus;
    private handleFinalStatus;
    private handleNonFinalStatus;
    private speakAndLog;
}
//# sourceMappingURL=call-processor.service.d.ts.map