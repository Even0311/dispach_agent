import { TranscriptChunk } from '../../types';
import { BaseDynamoDBService } from './base.service';
export interface CreateTranscriptChunkDto {
    speakerType: 'AI' | 'User';
    text: string;
    startAt: number;
}
export declare class TranscriptChunkService extends BaseDynamoDBService {
    private readonly tableName;
    createMany(transcriptId: string, chunks: CreateTranscriptChunkDto[]): Promise<TranscriptChunk[]>;
    findByTranscriptId(transcriptId: string): Promise<TranscriptChunk[]>;
    create(transcriptId: string, chunkDto: CreateTranscriptChunkDto): Promise<TranscriptChunk>;
}
//# sourceMappingURL=transcript-chunk.service.d.ts.map