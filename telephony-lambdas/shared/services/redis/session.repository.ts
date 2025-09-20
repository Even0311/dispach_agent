import Redis from 'ioredis';
import { CallSkeleton, SessionCompany, Message, SessionService } from '../../types';

const SESSION_PREFIX = 'call:';
const SESSION_TTL = 60 * 30; // 30 min

export class SessionRepository {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });
  }

  async load(callSid: string): Promise<CallSkeleton | null> {
    const raw: string | null = await this.redis.get(this.key(callSid));
    return raw !== null ? (JSON.parse(raw) as CallSkeleton) : null;
  }

  async create(callSid: string): Promise<CallSkeleton> {
    const skeleton = this.createEmptySkeleton(callSid);
    await this.redis.set(
      this.key(callSid),
      JSON.stringify(skeleton),
      'EX',
      SESSION_TTL,
    );
    return skeleton;
  }

  async save(session: CallSkeleton): Promise<void> {
    await this.redis.set(
      this.key(session.callSid),
      JSON.stringify(session),
      'EX',
      SESSION_TTL,
    );
  }

  async delete(callSid: string): Promise<void> {
    await this.redis.del(this.key(callSid));
  }

  async appendHistory(callSid: string, entry: Message): Promise<void> {
    const session = await this.load(callSid);
    if (!session) return;

    session.history.push(entry);
    await this.save(session);
  }

  async appendServices(callSid: string, services: SessionService[]): Promise<void> {
    const session = await this.load(callSid);
    if (!session) return;
    session.services = services;
    await this.save(session);
  }

  async appendCompany(callSid: string, company: SessionCompany): Promise<void> {
    const session = await this.load(callSid);
    if (!session) return;
    session.company = company;
    await this.save(session);
  }

  private key(callSid: string): string {
    return `${SESSION_PREFIX}${callSid}`;
  }

  private createEmptySkeleton(callSid: string): CallSkeleton {
    return {
      callSid,
      services: [],
      company: {
        id: '',
        name: '',
        email: '',
        userId: '',
        calendar_access_token: '',
      },
      user: {
        service: undefined,
        serviceBookedTime: undefined,
        userInfo: {
          name: '',
          phone: '',
          address: '', // Simplified to single address string
        },
      },
      history: [],
      servicebooked: false,
      confirmEmailsent: false,
      createdAt: new Date().toISOString(),
    };
  }
}