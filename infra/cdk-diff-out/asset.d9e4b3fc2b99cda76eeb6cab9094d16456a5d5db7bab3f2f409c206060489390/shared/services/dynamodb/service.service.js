"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceService = void 0;
const base_service_1 = require("./base.service");
class ServiceService extends base_service_1.BaseDynamoDBService {
    constructor() {
        super(...arguments);
        this.tableName = (() => {
            try {
                const tableNames = JSON.parse(process.env.DYNAMODB_TABLE_NAMES || '{}');
                return tableNames.services || process.env.SERVICES_TABLE_NAME || 'Telephony-Services';
            }
            catch {
                return process.env.SERVICES_TABLE_NAME || 'Telephony-Services';
            }
        })();
    }
    async findAllActiveByUserId(userId) {
        try {
            const services = await this.query(this.tableName, 'userId = :userId', {
                ':userId': userId,
            }, 'UserIdIndex' // GSI for userId
            );
            // Filter for active services (isAvailable = true, isDeleted != true)
            return services.filter(service => service.isAvailable === true && service.isDeleted !== true);
        }
        catch (error) {
            console.error('Error finding active services by user ID:', error);
            throw error;
        }
    }
    async findById(serviceId) {
        try {
            const service = await this.get(this.tableName, { _id: serviceId });
            return service || null;
        }
        catch (error) {
            console.error('Error finding service by ID:', error);
            throw error;
        }
    }
    async create(serviceData) {
        try {
            const serviceId = `service_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const service = {
                ...serviceData,
                _id: serviceId,
                isAvailable: serviceData.isAvailable ?? true,
                isDeleted: serviceData.isDeleted ?? false,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await this.put(this.tableName, service);
            return service;
        }
        catch (error) {
            console.error('Error creating service:', error);
            throw error;
        }
    }
}
exports.ServiceService = ServiceService;
//# sourceMappingURL=service.service.js.map