"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionHelper = void 0;
const session_repository_1 = require("./session.repository");
class SessionHelper {
    constructor() {
        this.sessions = new session_repository_1.SessionRepository();
    }
    async ensureSession(callSid) {
        let session = await this.sessions.load(callSid);
        session ?? (session = await this.sessions.create(callSid));
        return session;
    }
    async fillCompanyServices(callSid, services) {
        const telephonyServices = services.map(service => ({
            id: service._id,
            name: service.name,
            price: service.price,
            description: service.description,
        }));
        const session = await this.sessions.load(callSid);
        if (!session) {
            throw new Error('Session not found');
        }
        await this.sessions.appendServices(callSid, telephonyServices);
        console.log(`Sessions added with callId ${callSid}, and services ${JSON.stringify(telephonyServices)}`);
    }
    async appendUserMessage(callSid, message) {
        await this.appendMessage(callSid, 'customer', message);
        console.log(`Sessions added with callId ${callSid}, and message ${JSON.stringify(message)}`);
    }
    async appendAiMessage(callSid, message) {
        await this.appendMessage(callSid, 'AI', message);
    }
    async fillCompany(callSid, company, user) {
        const telephonyCompany = {
            id: company._id,
            name: company.businessName,
            email: user.email,
            userId: company.user,
            calendar_access_token: undefined, // Optional field not available in Company schema
        };
        await this.sessions.appendCompany(callSid, telephonyCompany);
        console.log(`Sessions added company with callId ${callSid}, and message ${JSON.stringify(telephonyCompany)}`);
    }
    async appendMessage(callSid, speaker, message) {
        await this.sessions.appendHistory(callSid, {
            speaker,
            message,
            startedAt: new Date().toISOString(),
        });
    }
}
exports.SessionHelper = SessionHelper;
//# sourceMappingURL=session.helper.js.map