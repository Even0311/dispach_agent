"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalllogService = void 0;
const base_service_1 = require("./base.service");
class CalllogService extends base_service_1.BaseDynamoDBService {
    constructor() {
        super(...arguments);
        this.tableName = process.env.CALLLOGS_TABLE_NAME || 'Telephony-CallLogs';
    }
    async create(createCallLogDto) {
        try {
            const callLogId = `calllog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const callLog = {
                ...createCallLogDto,
                _id: callLogId,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await this.put(this.tableName, callLog);
            return callLog;
        }
        catch (error) {
            console.error('Error creating call log:', error);
            throw error;
        }
    }
    async findByCallSid(callSid) {
        try {
            const callLogs = await this.query(this.tableName, 'callSid = :callSid', {
                ':callSid': callSid,
            }, 'CallSidIndex' // GSI for callSid
            );
            return callLogs.length > 0 ? callLogs[0] : null;
        }
        catch (error) {
            console.error('Error finding call log by call SID:', error);
            throw error;
        }
    }
    async findByUserId(userId, limit) {
        try {
            const callLogs = await this.query(this.tableName, 'userId = :userId', {
                ':userId': userId,
            }, 'UserIdIndex' // GSI for userId
            );
            // Sort by startAt descending (most recent first)
            const sortedLogs = callLogs.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
            return limit ? sortedLogs.slice(0, limit) : sortedLogs;
        }
        catch (error) {
            console.error('Error finding call logs by user ID:', error);
            throw error;
        }
    }
}
exports.CalllogService = CalllogService;
//# sourceMappingURL=calllog.service.js.map