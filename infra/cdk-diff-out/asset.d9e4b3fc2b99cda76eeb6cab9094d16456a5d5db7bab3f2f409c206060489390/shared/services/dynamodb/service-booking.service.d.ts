import { ServiceBooking, ServiceBookingStatus } from '../../types';
import { BaseDynamoDBService } from './base.service';
export interface CreateServiceBookingDto {
    serviceId: string;
    client: {
        name: string;
        phoneNumber: string;
        address: string;
    };
    serviceFormValues: {
        serviceFieldId: string;
        answer: string;
    }[];
    bookingTime: string;
    status: ServiceBookingStatus;
    note: string;
    userId: string;
    callSid: string;
}
export declare class ServiceBookingService extends BaseDynamoDBService {
    private readonly tableName;
    create(createServiceBookingDto: CreateServiceBookingDto): Promise<ServiceBooking>;
    findByCallSid(callSid: string): Promise<ServiceBooking | null>;
    findByUserId(userId: string, limit?: number): Promise<ServiceBooking[]>;
    findById(bookingId: string): Promise<ServiceBooking | null>;
    updateStatus(bookingId: string, status: ServiceBookingStatus): Promise<ServiceBooking>;
}
//# sourceMappingURL=service-booking.service.d.ts.map