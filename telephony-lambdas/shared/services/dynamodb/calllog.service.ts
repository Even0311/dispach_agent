import { CallLog } from '../../types';
import { BaseDynamoDBService } from './base.service';

export interface CreateCallLogDto {
  callSid: string;
  userId: string;
  serviceBookedId?: string;
  callerNumber: string;
  callerName?: string;
  startAt: Date;
}

export class CalllogService extends BaseDynamoDBService {
  private readonly tableName = process.env.CALLLOGS_TABLE_NAME || 'CallLogs';

  async create(createCallLogDto: CreateCallLogDto): Promise<CallLog> {
    try {
      const callLogId = `calllog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const callLog: CallLog = {
        ...createCallLogDto,
        _id: callLogId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.put(this.tableName, callLog);
      return callLog;
    } catch (error) {
      console.error('Error creating call log:', error);
      throw error;
    }
  }

  async findByCallSid(callSid: string): Promise<CallLog | null> {
    try {
      const callLogs = await this.query(
        this.tableName,
        'callSid = :callSid',
        {
          ':callSid': callSid,
        },
        'CallSidIndex' // GSI for callSid
      );

      return callLogs.length > 0 ? callLogs[0] as CallLog : null;
    } catch (error) {
      console.error('Error finding call log by call SID:', error);
      throw error;
    }
  }

  async findByUserId(userId: string, limit?: number): Promise<CallLog[]> {
    try {
      const callLogs = await this.query(
        this.tableName,
        'userId = :userId',
        {
          ':userId': userId,
        },
        'UserIdIndex' // GSI for userId
      );

      // Sort by startAt descending (most recent first)
      const sortedLogs = callLogs.sort((a, b) =>
        new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
      );

      return limit ? sortedLogs.slice(0, limit) : sortedLogs;
    } catch (error) {
      console.error('Error finding call logs by user ID:', error);
      throw error;
    }
  }
}