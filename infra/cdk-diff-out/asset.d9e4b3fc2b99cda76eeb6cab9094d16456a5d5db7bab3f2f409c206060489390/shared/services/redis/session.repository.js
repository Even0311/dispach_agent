"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionRepository = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const SESSION_PREFIX = 'call:';
const SESSION_TTL = 60 * 30; // 30 min
class SessionRepository {
    constructor() {
        this.redis = new ioredis_1.default({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB || '0'),
            enableReadyCheck: false,
            maxRetriesPerRequest: null,
        });
    }
    async load(callSid) {
        const raw = await this.redis.get(this.key(callSid));
        return raw !== null ? JSON.parse(raw) : null;
    }
    async create(callSid) {
        const skeleton = this.createEmptySkeleton(callSid);
        await this.redis.set(this.key(callSid), JSON.stringify(skeleton), 'EX', SESSION_TTL);
        return skeleton;
    }
    async save(session) {
        await this.redis.set(this.key(session.callSid), JSON.stringify(session), 'EX', SESSION_TTL);
    }
    async delete(callSid) {
        await this.redis.del(this.key(callSid));
    }
    async appendHistory(callSid, entry) {
        const session = await this.load(callSid);
        if (!session)
            return;
        session.history.push(entry);
        await this.save(session);
    }
    async appendServices(callSid, services) {
        const session = await this.load(callSid);
        if (!session)
            return;
        session.services = services;
        await this.save(session);
    }
    async appendCompany(callSid, company) {
        const session = await this.load(callSid);
        if (!session)
            return;
        session.company = company;
        await this.save(session);
    }
    key(callSid) {
        return `${SESSION_PREFIX}${callSid}`;
    }
    createEmptySkeleton(callSid) {
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
exports.SessionRepository = SessionRepository;
//# sourceMappingURL=session.repository.js.map