import { CallSkeleton, User, Service, Company } from '../../types';
export declare class SessionHelper {
    private sessions;
    constructor();
    ensureSession(callSid: string): Promise<CallSkeleton>;
    fillCompanyServices(callSid: string, services: Service[]): Promise<void>;
    appendUserMessage(callSid: string, message: string): Promise<void>;
    appendAiMessage(callSid: string, message: string): Promise<void>;
    fillCompany(callSid: string, company: Company, user: User): Promise<void>;
    private appendMessage;
}
//# sourceMappingURL=session.helper.d.ts.map