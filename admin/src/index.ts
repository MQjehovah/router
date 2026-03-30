import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

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
    await fastify.listen({ port: Number(process.env.PORT) || 3001 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();