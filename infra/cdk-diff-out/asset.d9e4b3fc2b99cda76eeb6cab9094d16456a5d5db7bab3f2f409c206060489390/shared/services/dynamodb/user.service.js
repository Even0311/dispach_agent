"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const base_service_1 = require("./base.service");
class UserService extends base_service_1.BaseDynamoDBService {
    constructor() {
        super(...arguments);
        this.tableName = (() => {
            try {
                const tableNames = JSON.parse(process.env.DYNAMODB_TABLE_NAMES || '{}');
                return tableNames.users || process.env.USERS_TABLE_NAME || 'Telephony-Users';
            }
            catch {
                return process.env.USERS_TABLE_NAME || 'Telephony-Users';
            }
        })();
    }
    async findByTwilioPhoneNumber(twilioPhoneNumber) {
        try {
            const users = await this.query(this.tableName, '#twilioPhoneNumber = :twilioPhoneNumber', {
                ':twilioPhoneNumber': twilioPhoneNumber,
            }, 'TwilioPhoneNumberIndex', // GSI for twilioPhoneNumber
            {
                '#twilioPhoneNumber': 'twilioPhoneNumber',
            });
            return users.length > 0 ? users[0] : null;
        }
        catch (error) {
            console.error('Error finding user by twilio phone number:', error);
            throw error;
        }
    }
    async findById(userId) {
        try {
            const user = await this.get(this.tableName, { _id: userId });
            return user || null;
        }
        catch (error) {
            console.error('Error finding user by ID:', error);
            throw error;
        }
    }
    async create(userData) {
        try {
            const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const user = {
                ...userData,
                _id: userId,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await this.put(this.tableName, user);
            return user;
        }
        catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }
}
exports.UserService = UserService;
//# sourceMappingURL=user.service.js.map