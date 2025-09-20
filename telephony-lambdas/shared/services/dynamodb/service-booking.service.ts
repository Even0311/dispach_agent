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
  bookingTime: string; // ISO string from original
  status: ServiceBookingStatus;
  note: string;
  userId: string;
  callSid: string;
}

export class ServiceBookingService extends BaseDynamoDBService {
  private readonly tableName = process.env.SERVICE_BOOKINGS_TABLE_NAME || 'ServiceBookings';

  async create(createServiceBookingDto: CreateServiceBookingDto): Promise<ServiceBooking> {
    try {
      const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const booking: ServiceBooking = {
        ...createServiceBookingDto,
        _id: bookingId,
        bookingTime: new Date(createServiceBookingDto.bookingTime),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.put(this.tableName, booking);
      return booking;
    } catch (error) {
      console.error('Error creating service booking:', error);
      throw error;
    }
  }

  async findByCallSid(callSid: string): Promise<ServiceBooking | null> {
    try {
      const bookings = await this.query(
        this.tableName,
        '#callSid = :callSid',
        {
          ':callSid': callSid,
        },
        'CallSidIndex', // GSI for callSid
        {
          '#callSid': 'callSid',
        }
      );

      return bookings.length > 0 ? bookings[0] as ServiceBooking : null;
    } catch (error) {
      console.error('Error finding service booking by call SID:', error);
      throw error;
    }
  }

  async findByUserId(userId: string, limit?: number): Promise<ServiceBooking[]> {
    try {
      const bookings = await this.query(
        this.tableName,
        '#userId = :userId',
        {
          ':userId': userId,
        },
        'UserIdIndex', // GSI for userId
        {
          '#userId': 'userId',
        }
      );

      // Sort by bookingTime descending (most recent first)
      const sortedBookings = bookings.sort((a, b) =>
        new Date(b.bookingTime).getTime() - new Date(a.bookingTime).getTime()
      );

      return limit ? sortedBookings.slice(0, limit) : sortedBookings;
    } catch (error) {
      console.error('Error finding service bookings by user ID:', error);
      throw error;
    }
  }

  async findById(bookingId: string): Promise<ServiceBooking | null> {
    try {
      const booking = await this.get(this.tableName, { _id: bookingId });
      return booking as ServiceBooking || null;
    } catch (error) {
      console.error('Error finding service booking by ID:', error);
      throw error;
    }
  }

  async updateStatus(bookingId: string, status: ServiceBookingStatus): Promise<ServiceBooking> {
    try {
      const updatedBooking = await this.update(
        this.tableName,
        { _id: bookingId },
        'SET #status = :status, #updatedAt = :updatedAt',
        {
          ':status': status,
        },
        {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        }
      );

      return updatedBooking as ServiceBooking;
    } catch (error) {
      console.error('Error updating service booking status:', error);
      throw error;
    }
  }
}