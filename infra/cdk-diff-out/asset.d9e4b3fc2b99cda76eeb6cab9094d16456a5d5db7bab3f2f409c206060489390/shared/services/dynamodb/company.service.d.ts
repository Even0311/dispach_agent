import { Company } from '../../types';
import { BaseDynamoDBService } from './base.service';
export declare class CompanyService extends BaseDynamoDBService {
    private readonly tableName;
    findByUserId(userId: string): Promise<Company | null>;
    findById(companyId: string): Promise<Company | null>;
    create(companyData: Omit<Company, '_id' | 'createdAt' | 'updatedAt'>): Promise<Company>;
}
//# sourceMappingURL=company.service.d.ts.map