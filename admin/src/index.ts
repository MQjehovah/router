import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';

import { corsOrigins, requireSecret } from './env.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { keyRoutes } from './routes/keys.js';
import { internalRoutes } from './routes/internal.js';
import { ssoRoutes } from './routes/sso.js';
import { createAuthenticateSso } from './sso-auth.js';
import { providerRoutes } from './routes/providers.js';
import { modelRoutes } from './routes/models.js';
import { usageRoutes } from './routes/usage.js';
import { meRoutes } from './routes/me.js';
import { billingRoutes } from './routes/billing.js';
import { auditRoutes } from './routes/audit.js';

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

await fastify.register(cors, { 
  origin: corsOrigins(),
  credentials: true
});

/** 解析 admin 会话 TTL:未设置/空串用默认 12h;纯数字按“秒”处理;非法值启动即失败 */
function resolveAdminSessionTtl(): string {
  const raw = (process.env.ADMIN_SESSION_TTL ?? '').trim();
  if (!raw) return '12h';
  if (/^\d+$/.test(raw)) {
    const secs = Number(raw);
    if (!Number.isFinite(secs) || secs <= 0) {
      throw new Error(`ADMIN_SESSION_TTL 必须是正数: "${raw}"`);
    }
    return `${secs}s`;
  }
  if (!/^\d+(\.\d+)?(ms|s|m|h|d|w|y)$/i.test(raw)) {
    throw new Error(`ADMIN_SESSION_TTL 非法: "${raw}"(示例: 43200 或 12h)`);
  }
  return raw;
}

const adminSessionTtl = resolveAdminSessionTtl();

await fastify.register(jwt, {
  secret: requireSecret('JWT_SECRET', process.env.JWT_SECRET),
  sign: { expiresIn: adminSessionTtl }
});

fastify.decorate('prisma', prisma);

fastify.decorate('authenticate', async (req: any, reply: any) => {
  try {
    await req.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
});

fastify.decorate('authenticateSso', createAuthenticateSso(prisma));

await fastify.register(authRoutes);
await fastify.register(userRoutes);
await fastify.register(keyRoutes);
await fastify.register(internalRoutes);
await fastify.register(ssoRoutes);
await fastify.register(providerRoutes);
await fastify.register(modelRoutes);
await fastify.register(usageRoutes);
await fastify.register(meRoutes);
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