import { CallSkeleton, SessionCompany, Message, SessionService } from '../../types';
export declare class SessionRepository {
    private redis;
    constructor();
    load(callSid: string): Promise<CallSkeleton | null>;
    create(callSid: string): Promise<CallSkeleton>;
    save(session: CallSkeleton): Promise<void>;
    delete(callSid: string): Promise<void>;
    appendHistory(callSid: string, entry: Message): Promise<void>;
    appendServices(callSid: string, services: SessionService[]): Promise<void>;
    appendCompany(callSid: string, company: SessionCompany): Promise<void>;
    private key;
    private createEmptySkeleton;
}
//# sourceMappingURL=session.repository.d.ts.map