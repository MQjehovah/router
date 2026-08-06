import Fastify, { FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';

import { authenticate } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { quotaCheck } from './middleware/quota.js';
import { chatRoutes } from './routes/chat.js';
import { responsesRoutes } from './routes/responses.js';
import { messagesRoutes } from './routes/messages.js';

export async function buildApp(opts: FastifyServerOptions = {}) {
  const fastify = Fastify(opts);

  await fastify.register(cors, { origin: true, credentials: true });

  fastify.decorate('authenticate', authenticate);
  fastify.decorate('rateLimit', rateLimit);
  fastify.decorate('quotaCheck', quotaCheck);

  await fastify.register(chatRoutes);
  await fastify.register(responsesRoutes);
  await fastify.register(messagesRoutes);

  fastify.get('/health', async () => ({ status: 'ok' }));

  return fastify;
}
