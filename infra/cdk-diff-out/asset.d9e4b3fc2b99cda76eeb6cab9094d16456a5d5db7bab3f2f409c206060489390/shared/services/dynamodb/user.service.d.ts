import { User } from '../../types';
import { BaseDynamoDBService } from './base.service';
export declare class UserService extends BaseDynamoDBService {
    private readonly tableName;
    findByTwilioPhoneNumber(twilioPhoneNumber: string): Promise<User | null>;
    findById(userId: string): Promise<User | null>;
    create(userData: Omit<User, '_id' | 'createdAt' | 'updatedAt'>): Promise<User>;
}
//# sourceMappingURL=user.service.d.ts.map