import { User } from '../../types';
import { BaseDynamoDBService } from './base.service';

export class UserService extends BaseDynamoDBService {
  private readonly tableName = process.env.USERS_TABLE_NAME || 'Users';

  async findByTwilioPhoneNumber(twilioPhoneNumber: string): Promise<User | null> {
    try {
      const users = await this.query(
        this.tableName,
        '#twilioPhoneNumber = :twilioPhoneNumber',
        {
          ':twilioPhoneNumber': twilioPhoneNumber,
        },
        'TwilioPhoneNumberIndex', // GSI for twilioPhoneNumber
        {
          '#twilioPhoneNumber': 'twilioPhoneNumber',
        }
      );

      return users.length > 0 ? users[0] as User : null;
    } catch (error) {
      console.error('Error finding user by twilio phone number:', error);
      throw error;
    }
  }

  async findById(userId: string): Promise<User | null> {
    try {
      const user = await this.get(this.tableName, { _id: userId });
      return user as User || null;
    } catch (error) {
      console.error('Error finding user by ID:', error);
      throw error;
    }
  }

  async create(userData: Omit<User, '_id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    try {
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const user: User = {
        ...userData,
        _id: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.put(this.tableName, user);
      return user;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }
}