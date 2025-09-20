import { Transcript } from '../../types';
import { BaseDynamoDBService } from './base.service';

export interface CreateTranscriptDto {
  callSid: string;
  summary: string;
  keyPoints?: string[];
}

export class TranscriptService extends BaseDynamoDBService {
  private readonly tableName = process.env.TRANSCRIPTS_TABLE_NAME || 'Telephony-Transcripts';

  async create(createTranscriptDto: CreateTranscriptDto): Promise<Transcript> {
    try {
      const transcriptId = `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const transcript: Transcript = {
        ...createTranscriptDto,
        _id: transcriptId,
        keyPoints: createTranscriptDto.keyPoints || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.put(this.tableName, transcript);
      return transcript;
    } catch (error) {
      console.error('Error creating transcript:', error);
      throw error;
    }
  }

  async findByCallSid(callSid: string): Promise<Transcript | null> {
    try {
      const transcripts = await this.query(
        this.tableName,
        'callSid = :callSid',
        {
          ':callSid': callSid,
        },
        'CallSidIndex' // GSI for callSid
      );

      return transcripts.length > 0 ? transcripts[0] as Transcript : null;
    } catch (error) {
      console.error('Error finding transcript by call SID:', error);
      throw error;
    }
  }

  async findById(transcriptId: string): Promise<Transcript | null> {
    try {
      const transcript = await this.get(this.tableName, { _id: transcriptId });
      return transcript as Transcript || null;
    } catch (error) {
      console.error('Error finding transcript by ID:', error);
      throw error;
    }
  }
}