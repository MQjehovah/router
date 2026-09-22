import 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { SsoUser } from './sso-auth.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: number; email: string; role: 'ADMIN' | 'USER' };
    user: { id: number; email: string; role: 'ADMIN' | 'USER' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /// 共享 Prisma 客户端(index.ts 装配); 测试可用替身覆盖, 故声明为可选
    prisma?: PrismaClient;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateSso: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /// 员工端 SSO 鉴权通过后的最小用户信息(不含 passwordHash); 由 authenticateSso 装饰器保证存在
    ssoUser: SsoUser;
  }
}
