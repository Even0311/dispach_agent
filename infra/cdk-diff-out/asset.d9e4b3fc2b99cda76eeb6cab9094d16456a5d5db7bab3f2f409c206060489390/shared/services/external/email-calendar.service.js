"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailCalendarService = void 0;
const axios_1 = __importDefault(require("axios"));
class EmailCalendarService {
    constructor() {
        this.http = axios_1.default.create({
            timeout: 10000, // 10s timeout for external services
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    async sendEmailAndCalendar(request) {
        try {
            const dispatchServiceUrl = process.env.DISPATCH_SERVICE_URL;
            if (!dispatchServiceUrl) {
                throw new Error('DISPATCH_SERVICE_URL not configured');
            }
            await this.http.post(`${dispatchServiceUrl}/dispatch/send-email-and-calendar`, request);
            console.log('[EmailCalendarService] Successfully sent email and calendar invitation');
        }
        catch (error) {
            console.error('[EmailCalendarService] Failed to send email and calendar:', error);
            throw error;
        }
    }
}
exports.EmailCalendarService = EmailCalendarService;
//# sourceMappingURL=email-calendar.service.js.map