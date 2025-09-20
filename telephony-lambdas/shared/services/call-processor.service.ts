import {
  VoiceGatherBody,
  VoiceStatusBody,
  SYSTEM_RESPONSES,
  buildSayResponse,
  NextAction,
} from '../index';
import { SessionHelper } from './redis';
import { UserService, CompanyService, ServiceService } from './dynamodb';
import { WelcomeMessageHelper } from '../helpers';
import { AiIntegrationService } from './ai';
import { CallDataPersistenceService } from './call-data-persistence.service';

const GATHER_HANDLER_URL = process.env.GATHER_HANDLER_URL || process.env.PUBLIC_URL || 'https://your-domain/api';

export class CallProcessorService {
  private readonly statusHandlers: Record<
    string,
    (callSid: string, statusData: VoiceStatusBody) => Promise<void> | void
  > = {
    // Final statuses that require data persistence
    completed: this.handleCompletedStatus.bind(this),
    busy: this.handleFinalStatus.bind(this),
    failed: this.handleFinalStatus.bind(this),
    'no-answer': this.handleFinalStatus.bind(this),
    // Non-final statuses that only require logging
    queued: this.handleNonFinalStatus.bind(this),
    ringing: this.handleNonFinalStatus.bind(this),
    'in-progress': this.handleNonFinalStatus.bind(this),
  };

  // White list derived from statusHandlers and VoiceStatusBody interface
  private readonly validCallStatuses = new Set<string>(
    Object.keys(this.statusHandlers),
  );

  private sessionHelper: SessionHelper;
  private userService: UserService;
  private serviceService: ServiceService;
  private companyService: CompanyService;
  private aiIntegration: AiIntegrationService;
  private dataPersistence: CallDataPersistenceService;

  constructor() {
    this.sessionHelper = new SessionHelper();
    this.userService = new UserService();
    this.serviceService = new ServiceService();
    this.companyService = new CompanyService();
    this.aiIntegration = new AiIntegrationService();
    this.dataPersistence = new CallDataPersistenceService();
  }

  async handleVoice(voiceData: VoiceGatherBody): Promise<string> {
    const { CallSid, To } = voiceData;
    console.log(
      `[CallProcessorService][handleVoice] Full request data: ${JSON.stringify(voiceData)}`,
    );
    console.log(
      `[CallProcessorService][handleVoice] CallSid=${CallSid}, Looking for user with twilioPhoneNumber=${To}`,
    );

    await this.sessionHelper.ensureSession(CallSid);
    const user = await this.userService.findByTwilioPhoneNumber(To);
    if (user == null) {
      console.warn(
        `[CallProcessorService][handleVoice] No user found with twilioPhoneNumber=${To}`,
      );
      return this.speakAndLog(CallSid, 'User not found', NextAction.HANGUP);
    }

    const services = await this.serviceService.findAllActiveByUserId(user._id);
    await this.sessionHelper.fillCompanyServices(CallSid, services);
    const company = await this.companyService.findByUserId(user._id);

    if (!company) {
      console.warn(
        `[CallProcessorService][handleVoice] No company found for user ${user._id}`,
      );
      return this.speakAndLog(CallSid, 'Company not found', NextAction.HANGUP);
    }

    await this.sessionHelper.fillCompany(CallSid, company, user);

    const welcome = WelcomeMessageHelper.buildWelcomeMessage(
      company.businessName,
      services,
      company.greeting || {
        message: `Welcome to ${company.businessName}`,
        isCustom: false
      },
    );

    return this.speakAndLog(CallSid, welcome, NextAction.GATHER);
  }

  async handleGather({
    CallSid,
    SpeechResult = '',
  }: VoiceGatherBody): Promise<string> {
    await this.sessionHelper.ensureSession(CallSid);
    let reply: string = SYSTEM_RESPONSES.fallback;

    if (SpeechResult) {
      try {
        await this.sessionHelper.appendUserMessage(CallSid, SpeechResult);
        const aiReplyData = await this.aiIntegration.getAIReply(
          CallSid,
          SpeechResult,
        );
        reply = aiReplyData.message.trim() || SYSTEM_RESPONSES.fallback;

        // Check if AI indicates conversation should end
        if (aiReplyData.shouldHangup === true) {
          console.log(
            `[CallProcessorService][callSid=${CallSid}][handleGather] AI indicates conversation complete, hanging up`,
          );
          return await this.speakAndLog(CallSid, reply, NextAction.HANGUP);
        }
      } catch (err) {
        console.error(
          `[CallProcessorService][callSid=${CallSid}][handleGather] AI call failed`,
          { stack: (err as Error).stack },
        );
        reply = SYSTEM_RESPONSES.error;
      }
    }
    return this.speakAndLog(CallSid, reply, NextAction.GATHER);
  }

  async handleStatus(statusData: VoiceStatusBody): Promise<void> {
    const { CallSid, CallStatus } = statusData;

    // Validate CallStatus against white list
    if (!this.validCallStatuses.has(CallStatus)) {
      console.warn(
        `[CallProcessorService][callSid=${CallSid}][handleStatus] Invalid call status received: ${CallStatus}. Ignoring.`,
      );
      return;
    }

    // Get handler for the validated status (guaranteed to exist)
    const handler = this.statusHandlers[CallStatus];
    await handler(CallSid, statusData);

    console.log(
      `[CallProcessorService][callSid=${CallSid}][handleStatus] status=${CallStatus}`,
    );
  }

  private async handleCompletedStatus(
    callSid: string,
    statusData: VoiceStatusBody,
  ): Promise<void> {
    console.log(
      `[CallProcessorService][callSid=${callSid}][handleCompletedStatus] Processing completed call`,
    );

    try {
      await this.dataPersistence.processCallCompletion(callSid, statusData);
    } catch (error) {
      console.error(
        `[CallProcessorService][callSid=${callSid}][handleCompletedStatus] Failed to process call completion`,
        { error: (error as Error).message, stack: (error as Error).stack },
      );
    }
  }

  private async handleFinalStatus(
    callSid: string,
    statusData: VoiceStatusBody,
  ): Promise<void> {
    console.log(
      `[CallProcessorService][callSid=${callSid}][handleFinalStatus] Processing final call status: ${statusData.CallStatus}`,
    );

    try {
      await this.dataPersistence.processCallCompletion(callSid, statusData);
    } catch (error) {
      console.error(
        `[CallProcessorService][callSid=${callSid}][handleFinalStatus] Failed to process call completion for status ${statusData.CallStatus}`,
        { error: (error as Error).message, stack: (error as Error).stack },
      );
    }
  }

  private handleNonFinalStatus(
    callSid: string,
    statusData: VoiceStatusBody,
  ): void {
    // For non-final statuses, just log - no additional processing needed
    console.log(
      `[CallProcessorService][callSid=${callSid}][handleNonFinalStatus] Non-final status: ${statusData.CallStatus}`,
    );
  }

  private async speakAndLog(
    callSid: string,
    text: string,
    next: NextAction,
  ): Promise<string> {
    await this.sessionHelper.appendAiMessage(callSid, text);

    return buildSayResponse({
      text,
      next,
      sid: callSid,
      publicUrl: GATHER_HANDLER_URL,
    });
  }
}