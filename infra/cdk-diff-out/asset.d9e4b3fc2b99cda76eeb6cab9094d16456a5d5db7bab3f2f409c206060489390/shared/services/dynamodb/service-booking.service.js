"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceBookingService = void 0;
const base_service_1 = require("./base.service");
class ServiceBookingService extends base_service_1.BaseDynamoDBService {
    constructor() {
        super(...arguments);
        this.tableName = process.env.SERVICE_BOOKINGS_TABLE_NAME || 'Telephony-ServiceBookings';
    }
    async create(createServiceBookingDto) {
        try {
            const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const booking = {
                ...createServiceBookingDto,
                _id: bookingId,
                bookingTime: new Date(createServiceBookingDto.bookingTime),
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await this.put(this.tableName, booking);
            return booking;
        }
        catch (error) {
            console.error('Error creating service booking:', error);
            throw error;
        }
    }
    async findByCallSid(callSid) {
        try {
            const bookings = await this.query(this.tableName, '#callSid = :callSid', {
                ':callSid': callSid,
            }, 'CallSidIndex', // GSI for callSid
            {
                '#callSid': 'callSid',
            });
            return bookings.length > 0 ? bookings[0] : null;
        }
        catch (error) {
            console.error('Error finding service booking by call SID:', error);
            throw error;
        }
    }
    async findByUserId(userId, limit) {
        try {
            const bookings = await this.query(this.tableName, '#userId = :userId', {
                ':userId': userId,
            }, 'UserIdIndex', // GSI for userId
            {
                '#userId': 'userId',
            });
            // Sort by bookingTime descending (most recent first)
            const sortedBookings = bookings.sort((a, b) => new Date(b.bookingTime).getTime() - new Date(a.bookingTime).getTime());
            return limit ? sortedBookings.slice(0, limit) : sortedBookings;
        }
        catch (error) {
            console.error('Error finding service bookings by user ID:', error);
            throw error;
        }
    }
    async findById(bookingId) {
        try {
            const booking = await this.get(this.tableName, { _id: bookingId });
            return booking || null;
        }
        catch (error) {
            console.error('Error finding service booking by ID:', error);
            throw error;
        }
    }
    async updateStatus(bookingId, status) {
        try {
            const updatedBooking = await this.update(this.tableName, { _id: bookingId }, 'SET #status = :status, #updatedAt = :updatedAt', {
                ':status': status,
            }, {
                '#status': 'status',
                '#updatedAt': 'updatedAt',
            });
            return updatedBooking;
        }
        catch (error) {
            console.error('Error updating service booking status:', error);
            throw error;
        }
    }
}
exports.ServiceBookingService = ServiceBookingService;
//# sourceMappingURL=service-booking.service.js.map