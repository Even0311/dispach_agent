"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallDataPersistenceService = void 0;
const types_1 = require("../types");
const dynamodb_1 = require("./dynamodb");
const ai_1 = require("./ai");
const redis_1 = require("./redis");
const external_1 = require("./external");
const helpers_1 = require("../helpers");
class CallDataPersistenceService {
    constructor() {
        this.sessions = new redis_1.SessionRepository();
        this.callLogService = new dynamodb_1.CalllogService();
        this.transcriptService = new dynamodb_1.TranscriptService();
        this.transcriptChunkService = new dynamodb_1.TranscriptChunkService();
        this.serviceBookingService = new dynamodb_1.ServiceBookingService();
        this.aiSummaryService = new ai_1.AiSummaryService();
        this.emailCalendarService = new external_1.EmailCalendarService();
    }
    async processCallCompletion(callSid, twilioParams) {
        const session = await this.sessions.load(callSid);
        if (!session) {
            console.warn(`[CallDataPersistenceService][processCallCompletion] Session not found for callSid: ${callSid}`);
            return;
        }
        try {
            // Step 1: Generate AI summary first (independent operation)
            const aiSummary = await this.generateAISummaryForSession(session.callSid, session);
            // Step 2: Create service booking if service was booked
            const serviceBookingId = await this.createServiceBookingRecord(session.callSid, session.servicebooked, session.user.service, session.user.serviceBookedTime, session.user.userInfo, session.company.userId);
            // Step 3: Create call log record (last step to include all data)
            await this.createCallLogRecord(session.callSid, session.company.userId, serviceBookingId, twilioParams.Caller, session.user.userInfo.name || 'Unknown Caller', new Date(twilioParams.Timestamp));
            // Step 4: Create transcript and chunks
            await this.createTranscriptAndChunks(session.callSid, aiSummary.summary, aiSummary.keyPoints, session.history);
            // Step 5: Send email and calendar invitation
            await this.sendEmailAndCalendar(session, aiSummary.summary);
            // Clean up Redis session
            await this.sessions.delete(callSid);
            console.log(`[CallDataPersistenceService][processCallCompletion] Successfully processed call completion for ${callSid}`);
        }
        catch (error) {
            console.error(`[CallDataPersistenceService][processCallCompletion] Error processing call ${callSid}`, { error: error.message, stack: error.stack });
            throw error;
        }
    }
    async generateAISummaryForSession(callSid, session) {
        try {
            const aiSummary = await this.aiSummaryService.generateSummary(callSid, session, {
                enableFallback: true,
                fallbackSummary: 'Call summary generation failed',
                fallbackKeyPoints: ['Summary could not be generated'],
            });
            console.log(`[CallDataPersistenceService][generateAISummaryForSession] Generated AI summary for ${callSid}`);
            return aiSummary;
        }
        catch (error) {
            console.error(`[CallDataPersistenceService][generateAISummaryForSession] Failed to generate AI summary for ${callSid}`, { error: error.message });
            // Return fallback summary if generation fails
            return {
                summary: 'Call summary generation failed',
                keyPoints: ['Summary could not be generated'],
            };
        }
    }
    async createCallLogRecord(callSid, userId, serviceBookedId, callerNumber, callerName, startAt) {
        const callLog = await this.callLogService.create({
            callSid,
            userId,
            serviceBookedId,
            callerNumber,
            callerName,
            startAt,
        });
        console.log(`[CallDataPersistenceService][createCallLogRecord] Created CallLog for ${callSid}`);
    }
    async createTranscriptAndChunks(callSid, summary, keyPoints, history) {
        // Create transcript record with AI-generated summary
        const transcript = await this.transcriptService.create({
            callSid,
            summary,
            keyPoints,
        });
        // Create transcript chunk DTOs from conversation history
        const chunkDtos = helpers_1.DataTransformerHelper.convertMessagesToChunks(history);
        // Create transcript chunks from conversation history
        if (chunkDtos.length > 0) {
            await this.transcriptChunkService.createMany(transcript._id, chunkDtos);
        }
        console.log(`[CallDataPersistenceService][createTranscriptAndChunks] Created transcript and chunks for ${callSid}`);
    }
    async createServiceBookingRecord(callSid, servicebooked, service, serviceBookedTime, userInfo, userId) {
        // Return early if no service was booked
        if (!servicebooked || service == null || serviceBookedTime == null) {
            console.log(`[CallDataPersistenceService][createServiceBookingRecord] No service booking required for ${callSid}`);
            return undefined;
        }
        // Get customer address string (simplified address structure)
        const addressString = helpers_1.ValidationHelper.getFallbackAddress(userInfo.address);
        // Create service booking data
        const serviceBookingData = {
            serviceId: service.id,
            client: {
                name: userInfo.name || 'Name not provided',
                phoneNumber: userInfo.phone || 'Phone not provided',
                address: addressString,
            },
            serviceFormValues: [
                {
                    serviceFieldId: 'booking_source',
                    answer: 'Phone Call',
                },
                {
                    serviceFieldId: 'call_sid',
                    answer: callSid,
                },
            ],
            bookingTime: serviceBookedTime,
            status: types_1.ServiceBookingStatus.Confirmed,
            note: `Service booked via phone call.`,
            userId: userId,
            callSid: callSid,
        };
        try {
            const serviceBooking = await this.serviceBookingService.create(serviceBookingData);
            const serviceBookingId = serviceBooking._id;
            console.log(`[CallDataPersistenceService][createServiceBookingRecord] Service booking created successfully for ${callSid}, booking ID: ${serviceBookingId}`);
            return serviceBookingId;
        }
        catch (error) {
            console.error(`[CallDataPersistenceService][createServiceBookingRecord] Failed to create service booking for ${callSid}`, { error: error.message, stack: error.stack });
            throw error;
        }
    }
    async sendEmailAndCalendar(session, summary) {
        try {
            await this.emailCalendarService.sendEmailAndCalendar({
                to: session.company.email,
                subject: 'Service Booking Confirmation',
                body: summary,
                summary: session.user.service?.name || 'Service Booking',
                start: session.user.serviceBookedTime || new Date().toISOString(),
                end: session.user.serviceBookedTime != null &&
                    session.user.serviceBookedTime.trim() !== ''
                    ? new Date(new Date(session.user.serviceBookedTime).getTime() +
                        60 * 60 * 1000).toISOString()
                    : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                description: (session.user.userInfo.name || 'Customer') +
                    ' has ordered ' +
                    (session.user.service?.name || 'service') +
                    ' at ' +
                    (session.user.serviceBookedTime || 'scheduled time') +
                    ' at ' +
                    helpers_1.ValidationHelper.getFallbackAddress(session.user.userInfo.address || 'specified location'),
                location: helpers_1.ValidationHelper.getFallbackAddress(session.user.userInfo.address),
                attendees: [session.company.email],
                alarm_minutes_before: 10,
                calendarapp: 'none',
            });
        }
        catch (error) {
            console.error('Failed to send email and calendar:', error);
            // Don't throw here - email failure shouldn't break the whole process
        }
    }
}
exports.CallDataPersistenceService = CallDataPersistenceService;
//# sourceMappingURL=call-data-persistence.service.js.map