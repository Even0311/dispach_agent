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
export declare class EmailCalendarService {
    private http;
    constructor();
    sendEmailAndCalendar(request: EmailCalendarRequest): Promise<void>;
}
//# sourceMappingURL=email-calendar.service.d.ts.map