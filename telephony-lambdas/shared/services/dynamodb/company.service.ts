import { Company } from '../../types';
import { BaseDynamoDBService } from './base.service';

export class CompanyService extends BaseDynamoDBService {
  private readonly tableName = process.env.COMPANIES_TABLE_NAME || 'Companies';

  async findByUserId(userId: string): Promise<Company | null> {
    try {
      const companies = await this.query(
        this.tableName,
        '#user = :userId',
        {
          ':userId': userId,
        },
        'UserIdIndex', // GSI for userId
        {
          '#user': 'user', // Define the attribute name placeholder - field name is 'user' not 'userId'
        }
      );

      return companies.length > 0 ? companies[0] as Company : null;
    } catch (error) {
      console.error('Error finding company by user ID:', error);
      throw error;
    }
  }

  async findById(companyId: string): Promise<Company | null> {
    try {
      const company = await this.get(this.tableName, { _id: companyId });
      return company as Company || null;
    } catch (error) {
      console.error('Error finding company by ID:', error);
      throw error;
    }
  }

  async create(companyData: Omit<Company, '_id' | 'createdAt' | 'updatedAt'>): Promise<Company> {
    try {
      const companyId = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const company: Company = {
        ...companyData,
        _id: companyId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.put(this.tableName, company);
      return company;
    } catch (error) {
      console.error('Error creating company:', error);
      throw error;
    }
  }
}