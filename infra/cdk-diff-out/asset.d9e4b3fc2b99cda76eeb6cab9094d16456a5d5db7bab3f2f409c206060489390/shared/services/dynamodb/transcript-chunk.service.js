"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TranscriptChunkService = void 0;
const base_service_1 = require("./base.service");
class TranscriptChunkService extends base_service_1.BaseDynamoDBService {
    constructor() {
        super(...arguments);
        this.tableName = process.env.TRANSCRIPT_CHUNKS_TABLE_NAME || 'Telephony-TranscriptChunks';
    }
    async createMany(transcriptId, chunks) {
        try {
            const createdChunks = [];
            // DynamoDB doesn't have a native batch insert with auto-generated IDs
            // So we'll create them one by one (could be optimized with BatchWriteItem)
            for (const chunkDto of chunks) {
                const chunkId = `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const chunk = {
                    ...chunkDto,
                    _id: chunkId,
                    transcriptId,
                    speaker: chunkDto.speakerType === 'AI' ? 'AI' : 'customer',
                    message: chunkDto.text,
                    startedAt: new Date(chunkDto.startAt).toISOString(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                await this.put(this.tableName, chunk);
                createdChunks.push(chunk);
            }
            return createdChunks;
        }
        catch (error) {
            console.error('Error creating transcript chunks:', error);
            throw error;
        }
    }
    async findByTranscriptId(transcriptId) {
        try {
            const chunks = await this.query(this.tableName, 'transcriptId = :transcriptId', {
                ':transcriptId': transcriptId,
            }, 'TranscriptIdIndex' // GSI for transcriptId
            );
            // Sort by startedAt ascending (chronological order)
            return chunks.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
        }
        catch (error) {
            console.error('Error finding transcript chunks by transcript ID:', error);
            throw error;
        }
    }
    async create(transcriptId, chunkDto) {
        try {
            const chunkId = `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const chunk = {
                ...chunkDto,
                _id: chunkId,
                transcriptId,
                speaker: chunkDto.speakerType === 'AI' ? 'AI' : 'customer',
                message: chunkDto.text,
                startedAt: new Date(chunkDto.startAt).toISOString(),
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await this.put(this.tableName, chunk);
            return chunk;
        }
        catch (error) {
            console.error('Error creating transcript chunk:', error);
            throw error;
        }
    }
}
exports.TranscriptChunkService = TranscriptChunkService;
//# sourceMappingURL=transcript-chunk.service.js.map