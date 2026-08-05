import 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: number; email: string; role: 'ADMIN' | 'USER' };
    user: { id: number; email: string; role: 'ADMIN' | 'USER' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
