import { Service } from '../../types';
import { BaseDynamoDBService } from './base.service';
export declare class ServiceService extends BaseDynamoDBService {
    private readonly tableName;
    findAllActiveByUserId(userId: string): Promise<Service[]>;
    findById(serviceId: string): Promise<Service | null>;
    create(serviceData: Omit<Service, '_id' | 'createdAt' | 'updatedAt'>): Promise<Service>;
}
//# sourceMappingURL=service.service.d.ts.map