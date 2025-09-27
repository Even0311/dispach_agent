import { Transcript } from '../../types';
import { BaseDynamoDBService } from './base.service';
export interface CreateTranscriptDto {
    callSid: string;
    summary: string;
    keyPoints?: string[];
}
export declare class TranscriptService extends BaseDynamoDBService {
    private readonly tableName;
    create(createTranscriptDto: CreateTranscriptDto): Promise<Transcript>;
    findByCallSid(callSid: string): Promise<Transcript | null>;
    findById(transcriptId: string): Promise<Transcript | null>;
}
//# sourceMappingURL=transcript.service.d.ts.map