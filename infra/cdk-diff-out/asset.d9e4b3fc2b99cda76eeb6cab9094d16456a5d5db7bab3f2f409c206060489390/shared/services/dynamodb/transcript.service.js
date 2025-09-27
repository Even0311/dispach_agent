"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TranscriptService = void 0;
const base_service_1 = require("./base.service");
class TranscriptService extends base_service_1.BaseDynamoDBService {
    constructor() {
        super(...arguments);
        this.tableName = process.env.TRANSCRIPTS_TABLE_NAME || 'Telephony-Transcripts';
    }
    async create(createTranscriptDto) {
        try {
            const transcriptId = `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const transcript = {
                ...createTranscriptDto,
                _id: transcriptId,
                keyPoints: createTranscriptDto.keyPoints || [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await this.put(this.tableName, transcript);
            return transcript;
        }
        catch (error) {
            console.error('Error creating transcript:', error);
            throw error;
        }
    }
    async findByCallSid(callSid) {
        try {
            const transcripts = await this.query(this.tableName, 'callSid = :callSid', {
                ':callSid': callSid,
            }, 'CallSidIndex' // GSI for callSid
            );
            return transcripts.length > 0 ? transcripts[0] : null;
        }
        catch (error) {
            console.error('Error finding transcript by call SID:', error);
            throw error;
        }
    }
    async findById(transcriptId) {
        try {
            const transcript = await this.get(this.tableName, { _id: transcriptId });
            return transcript || null;
        }
        catch (error) {
            console.error('Error finding transcript by ID:', error);
            throw error;
        }
    }
}
exports.TranscriptService = TranscriptService;
//# sourceMappingURL=transcript.service.js.map