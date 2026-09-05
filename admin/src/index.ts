import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { keyRoutes } from './routes/keys.js';
import { internalRoutes } from './routes/internal.js';
import { ssoRoutes } from './routes/sso.js';
import { providerRoutes } from './routes/providers.js';
import { modelRoutes } from './routes/models.js';
import { usageRoutes } from './routes/usage.js';
import { billingRoutes } from './routes/billing.js';
import { auditRoutes } from './routes/audit.js';

dotenv.config();

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

await fastify.register(cors, { 
  origin: true,
  credentials: true
});

await fastify.register(jwt, { 
  secret: process.env.JWT_SECRET || 'default-secret'
});

fastify.decorate('prisma', prisma);

fastify.decorate('authenticate', async (req: any, reply: any) => {
  try {
    await req.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
});

await fastify.register(authRoutes);
await fastify.register(userRoutes);
await fastify.register(keyRoutes);
await fastify.register(internalRoutes);
await fastify.register(ssoRoutes);
await fastify.register(providerRoutes);
await fastify.register(modelRoutes);
await fastify.register(usageRoutes);
await fastify.register(billingRoutes);
await fastify.register(auditRoutes);

fastify.get('/health', async () => {
  try {
    await prisma.$connect();
    return { status: 'ok', database: 'connected' };
  } catch {
    return { status: 'error', database: 'disconnected' };
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: Number(process.env.PORT) || 3001, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();