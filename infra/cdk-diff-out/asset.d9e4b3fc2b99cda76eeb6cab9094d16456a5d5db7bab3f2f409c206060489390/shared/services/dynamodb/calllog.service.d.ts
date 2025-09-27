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
export declare class CalllogService extends BaseDynamoDBService {
    private readonly tableName;
    create(createCallLogDto: CreateCallLogDto): Promise<CallLog>;
    findByCallSid(callSid: string): Promise<CallLog | null>;
    findByUserId(userId: string, limit?: number): Promise<CallLog[]>;
}
//# sourceMappingURL=calllog.service.d.ts.map