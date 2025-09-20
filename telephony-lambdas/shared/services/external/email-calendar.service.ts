import axios, { AxiosInstance } from 'axios';

export interface EmailCalendarRequest {
  to: string;
  subject: string;
  body: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  location: string;
  attendees: string[];
  alarm_minutes_before: number;
  calendarapp: string;
}

export class EmailCalendarService {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      timeout: 10000, // 10s timeout for external services
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async sendEmailAndCalendar(request: EmailCalendarRequest): Promise<void> {
    try {
      const dispatchServiceUrl = process.env.DISPATCH_SERVICE_URL;
      if (!dispatchServiceUrl) {
        throw new Error('DISPATCH_SERVICE_URL not configured');
      }

      await this.http.post(`${dispatchServiceUrl}/dispatch/send-email-and-calendar`, request);

      console.log('[EmailCalendarService] Successfully sent email and calendar invitation');
    } catch (error) {
      console.error('[EmailCalendarService] Failed to send email and calendar:', error);
      throw error;
    }
  }
}