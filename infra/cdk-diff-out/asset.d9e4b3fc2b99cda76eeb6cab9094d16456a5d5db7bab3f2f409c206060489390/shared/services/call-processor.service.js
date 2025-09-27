"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallProcessorService = void 0;
const index_1 = require("../index");
const redis_1 = require("./redis");
const dynamodb_1 = require("./dynamodb");
const helpers_1 = require("../helpers");
const ai_1 = require("./ai");
const call_data_persistence_service_1 = require("./call-data-persistence.service");
const GATHER_HANDLER_URL = process.env.GATHER_HANDLER_URL || process.env.PUBLIC_URL || 'https://your-domain/api';
class CallProcessorService {
    constructor() {
        this.statusHandlers = {
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
        this.validCallStatuses = new Set(Object.keys(this.statusHandlers));
        this.sessionHelper = new redis_1.SessionHelper();
        this.userService = new dynamodb_1.UserService();
        this.serviceService = new dynamodb_1.ServiceService();
        this.companyService = new dynamodb_1.CompanyService();
        this.aiIntegration = new ai_1.AiIntegrationService();
        this.dataPersistence = new call_data_persistence_service_1.CallDataPersistenceService();
    }
    async handleVoice(voiceData) {
        const { CallSid, To } = voiceData;
        console.log(`[CallProcessorService][handleVoice] Full request data: ${JSON.stringify(voiceData)}`);
        console.log(`[CallProcessorService][handleVoice] CallSid=${CallSid}, Looking for user with twilioPhoneNumber=${To}`);
        await this.sessionHelper.ensureSession(CallSid);
        const user = await this.userService.findByTwilioPhoneNumber(To);
        if (user == null) {
            console.warn(`[CallProcessorService][handleVoice] No user found with twilioPhoneNumber=${To}`);
            return this.speakAndLog(CallSid, 'User not found', index_1.NextAction.HANGUP);
        }
        const services = await this.serviceService.findAllActiveByUserId(user._id);
        await this.sessionHelper.fillCompanyServices(CallSid, services);
        const company = await this.companyService.findByUserId(user._id);
        if (!company) {
            console.warn(`[CallProcessorService][handleVoice] No company found for user ${user._id}`);
            return this.speakAndLog(CallSid, 'Company not found', index_1.NextAction.HANGUP);
        }
        await this.sessionHelper.fillCompany(CallSid, company, user);
        const welcome = helpers_1.WelcomeMessageHelper.buildWelcomeMessage(company.businessName, services, company.greeting || {
            message: `Welcome to ${company.businessName}`,
            isCustom: false
        });
        return this.speakAndLog(CallSid, welcome, index_1.NextAction.GATHER);
    }
    async handleGather({ CallSid, SpeechResult = '', }) {
        await this.sessionHelper.ensureSession(CallSid);
        let reply = index_1.SYSTEM_RESPONSES.fallback;
        if (SpeechResult) {
            try {
                await this.sessionHelper.appendUserMessage(CallSid, SpeechResult);
                const aiReplyData = await this.aiIntegration.getAIReply(CallSid, SpeechResult);
                reply = aiReplyData.message.trim() || index_1.SYSTEM_RESPONSES.fallback;
                // Check if AI indicates conversation should end
                if (aiReplyData.shouldHangup === true) {
                    console.log(`[CallProcessorService][callSid=${CallSid}][handleGather] AI indicates conversation complete, hanging up`);
                    return await this.speakAndLog(CallSid, reply, index_1.NextAction.HANGUP);
                }
            }
            catch (err) {
                console.error(`[CallProcessorService][callSid=${CallSid}][handleGather] AI call failed`, { stack: err.stack });
                reply = index_1.SYSTEM_RESPONSES.error;
            }
        }
        return this.speakAndLog(CallSid, reply, index_1.NextAction.GATHER);
    }
    async handleStatus(statusData) {
        const { CallSid, CallStatus } = statusData;
        // Validate CallStatus against white list
        if (!this.validCallStatuses.has(CallStatus)) {
            console.warn(`[CallProcessorService][callSid=${CallSid}][handleStatus] Invalid call status received: ${CallStatus}. Ignoring.`);
            return;
        }
        // Get handler for the validated status (guaranteed to exist)
        const handler = this.statusHandlers[CallStatus];
        await handler(CallSid, statusData);
        console.log(`[CallProcessorService][callSid=${CallSid}][handleStatus] status=${CallStatus}`);
    }
    async handleCompletedStatus(callSid, statusData) {
        console.log(`[CallProcessorService][callSid=${callSid}][handleCompletedStatus] Processing completed call`);
        try {
            await this.dataPersistence.processCallCompletion(callSid, statusData);
        }
        catch (error) {
            console.error(`[CallProcessorService][callSid=${callSid}][handleCompletedStatus] Failed to process call completion`, { error: error.message, stack: error.stack });
        }
    }
    async handleFinalStatus(callSid, statusData) {
        console.log(`[CallProcessorService][callSid=${callSid}][handleFinalStatus] Processing final call status: ${statusData.CallStatus}`);
        try {
            await this.dataPersistence.processCallCompletion(callSid, statusData);
        }
        catch (error) {
            console.error(`[CallProcessorService][callSid=${callSid}][handleFinalStatus] Failed to process call completion for status ${statusData.CallStatus}`, { error: error.message, stack: error.stack });
        }
    }
    handleNonFinalStatus(callSid, statusData) {
        // For non-final statuses, just log - no additional processing needed
        console.log(`[CallProcessorService][callSid=${callSid}][handleNonFinalStatus] Non-final status: ${statusData.CallStatus}`);
    }
    async speakAndLog(callSid, text, next) {
        await this.sessionHelper.appendAiMessage(callSid, text);
        return (0, index_1.buildSayResponse)({
            text,
            next,
            sid: callSid,
            publicUrl: GATHER_HANDLER_URL,
        });
    }
}
exports.CallProcessorService = CallProcessorService;
//# sourceMappingURL=call-processor.service.js.map