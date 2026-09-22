import 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '@prisma/client';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: number; email: string; role: 'ADMIN' | 'USER' };
    user: { id: number; email: string; role: 'ADMIN' | 'USER' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateSso: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /// authenticateSso 通过后挂载的员工用户
    ssoUser?: User;
  }
}
