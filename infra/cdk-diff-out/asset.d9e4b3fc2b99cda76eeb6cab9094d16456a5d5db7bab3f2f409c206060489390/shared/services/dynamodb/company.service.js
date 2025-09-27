"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompanyService = void 0;
const base_service_1 = require("./base.service");
class CompanyService extends base_service_1.BaseDynamoDBService {
    constructor() {
        super(...arguments);
        this.tableName = (() => {
            try {
                const tableNames = JSON.parse(process.env.DYNAMODB_TABLE_NAMES || '{}');
                return tableNames.companies || process.env.COMPANIES_TABLE_NAME || 'Telephony-Companies';
            }
            catch {
                return process.env.COMPANIES_TABLE_NAME || 'Telephony-Companies';
            }
        })();
    }
    async findByUserId(userId) {
        try {
            const companies = await this.query(this.tableName, '#user = :userId', {
                ':userId': userId,
            }, 'UserIdIndex', // GSI for userId
            {
                '#user': 'user', // Define the attribute name placeholder - field name is 'user' not 'userId'
            });
            return companies.length > 0 ? companies[0] : null;
        }
        catch (error) {
            console.error('Error finding company by user ID:', error);
            throw error;
        }
    }
    async findById(companyId) {
        try {
            const company = await this.get(this.tableName, { _id: companyId });
            return company || null;
        }
        catch (error) {
            console.error('Error finding company by ID:', error);
            throw error;
        }
    }
    async create(companyData) {
        try {
            const companyId = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const company = {
                ...companyData,
                _id: companyId,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await this.put(this.tableName, company);
            return company;
        }
        catch (error) {
            console.error('Error creating company:', error);
            throw error;
        }
    }
}
exports.CompanyService = CompanyService;
//# sourceMappingURL=company.service.js.map