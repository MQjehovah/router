import 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    rateLimit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
