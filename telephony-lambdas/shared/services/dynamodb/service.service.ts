import { Service } from '../../types';
import { BaseDynamoDBService } from './base.service';

export class ServiceService extends BaseDynamoDBService {
  private readonly tableName = (() => {
    try {
      const tableNames = JSON.parse(process.env.DYNAMODB_TABLE_NAMES || '{}');
      return tableNames.services || process.env.SERVICES_TABLE_NAME || 'Telephony-Services';
    } catch {
      return process.env.SERVICES_TABLE_NAME || 'Telephony-Services';
    }
  })();

  async findAllActiveByUserId(userId: string): Promise<Service[]> {
    try {
      const services = await this.query(
        this.tableName,
        'userId = :userId',
        {
          ':userId': userId,
        },
        'UserIdIndex' // GSI for userId
      );

      // Filter for active services (isAvailable = true, isDeleted != true)
      return services.filter(service =>
        service.isAvailable === true && service.isDeleted !== true
      ) as Service[];
    } catch (error) {
      console.error('Error finding active services by user ID:', error);
      throw error;
    }
  }

  async findById(serviceId: string): Promise<Service | null> {
    try {
      const service = await this.get(this.tableName, { _id: serviceId });
      return service as Service || null;
    } catch (error) {
      console.error('Error finding service by ID:', error);
      throw error;
    }
  }

  async create(serviceData: Omit<Service, '_id' | 'createdAt' | 'updatedAt'>): Promise<Service> {
    try {
      const serviceId = `service_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const service: Service = {
        ...serviceData,
        _id: serviceId,
        isAvailable: serviceData.isAvailable ?? true,
        isDeleted: serviceData.isDeleted ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.put(this.tableName, service);
      return service;
    } catch (error) {
      console.error('Error creating service:', error);
      throw error;
    }
  }
}