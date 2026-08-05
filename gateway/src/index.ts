import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

import { authenticate } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { chatRoutes } from './routes/chat.js';

dotenv.config();

const fastify = Fastify({ logger: true });

await fastify.register(cors, { 
  origin: true,
  credentials: true
});

fastify.decorate('authenticate', authenticate);
fastify.decorate('rateLimit', rateLimit);

await fastify.register(chatRoutes);

fastify.get('/health', async () => {
  return { status: 'ok' };
});

const start = async () => {
  try {
    await fastify.listen({ port: Number(process.env.PORT) || 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();