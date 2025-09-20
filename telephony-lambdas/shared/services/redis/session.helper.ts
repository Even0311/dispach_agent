import { CallSkeleton, SessionCompany, SessionService, User, UserInfo, Service, Company } from '../../types';
import { SessionRepository } from './session.repository';

export class SessionHelper {
  private sessions: SessionRepository;

  constructor() {
    this.sessions = new SessionRepository();
  }

  async ensureSession(callSid: string): Promise<CallSkeleton> {
    let session = await this.sessions.load(callSid);
    session ??= await this.sessions.create(callSid);
    return session;
  }

  async fillCompanyServices(
    callSid: string,
    services: Service[],
  ): Promise<void> {
    const telephonyServices: SessionService[] = services.map(service => ({
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

  async appendUserMessage(callSid: string, message: string): Promise<void> {
    await this.appendMessage(callSid, 'customer', message);
    console.log(`Sessions added with callId ${callSid}, and message ${JSON.stringify(message)}`);
  }

  async appendAiMessage(callSid: string, message: string): Promise<void> {
    await this.appendMessage(callSid, 'AI', message);
  }

  async fillCompany(
    callSid: string,
    company: Company,
    user: User,
  ): Promise<void> {
    const telephonyCompany: SessionCompany = {
      id: company._id,
      name: company.businessName,
      email: user.email,
      userId: company.user,
      calendar_access_token: undefined, // Optional field not available in Company schema
    };
    await this.sessions.appendCompany(callSid, telephonyCompany);
    console.log(`Sessions added company with callId ${callSid}, and message ${JSON.stringify(telephonyCompany)}`);
  }

  private async appendMessage(
    callSid: string,
    speaker: 'AI' | 'customer',
    message: string,
  ): Promise<void> {
    await this.sessions.appendHistory(callSid, {
      speaker,
      message,
      startedAt: new Date().toISOString(),
    });
  }
}