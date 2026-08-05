import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CreateKeyBody {
  name: string;
  userId?: number;
  rateLimit?: number;
  dailyQuota?: number;
  monthlyQuota?: number;
  expiresAt?: string;
  modelIds?: number[];
}

interface UpdateKeyBody {
  name?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  rateLimit?: number;
  dailyQuota?: number;
  monthlyQuota?: number;
  expiresAt?: string;
  modelIds?: number[];
}

function generateApiKey(): string {
  return `sk-${crypto.randomBytes(32).toString('hex')}`;
}

function hashKey(key: string): string {
  return bcrypt.hashSync(key, 10);
}

export async function keyRoutes(fastify: FastifyInstance) {
  fastify.get('/api/keys', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
    
    const keys = await prisma.apiKey.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        allowedModels: { include: { model: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return keys.map(k => ({
      ...k,
      keyHash: k.keyHash.substring(0, 8) + '****',
      allowedModels: k.allowedModels.map(a => a.model),
      createdAt: k.createdAt.toISOString(),
      expiresAt: k.expiresAt?.toISOString()
    }));
  });

  fastify.post<{ Body: CreateKeyBody }>('/api/keys', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const userId = req.user.role === 'ADMIN' && req.body.userId ? req.body.userId : req.user.id;
    
    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    
    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        keyHash,
        name: req.body.name,
        rateLimit: req.body.rateLimit || 60,
        dailyQuota: req.body.dailyQuota || 100000,
        monthlyQuota: req.body.monthlyQuota || 3000000,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        allowedModels: req.body.modelIds?.length
          ? { create: req.body.modelIds.map(modelId => ({ modelId })) }
          : undefined
      }
    });

    return {
      id: apiKey.id,
      key: rawKey,
      name: apiKey.name,
      rateLimit: apiKey.rateLimit,
      dailyQuota: apiKey.dailyQuota,
      monthlyQuota: apiKey.monthlyQuota,
      createdAt: apiKey.createdAt.toISOString(),
      expiresAt: apiKey.expiresAt?.toISOString()
    };
  });

  fastify.put<{ Params: { id: string }, Body: UpdateKeyBody }>('/api/keys/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const keyId = parseInt(req.params.id);
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    
    if (!key) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    
    if (req.user.role !== 'ADMIN' && key.userId !== req.user.id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const data: any = {};
    if (req.body.name) data.name = req.body.name;
    if (req.body.status) data.status = req.body.status;
    if (req.body.rateLimit) data.rateLimit = req.body.rateLimit;
    if (req.body.dailyQuota) data.dailyQuota = req.body.dailyQuota;
    if (req.body.monthlyQuota) data.monthlyQuota = req.body.monthlyQuota;
    if (req.body.expiresAt) data.expiresAt = new Date(req.body.expiresAt);

    const updated = await prisma.$transaction(async (tx) => {
      if (req.body.modelIds) {
        await tx.apiKeyAllowedModel.deleteMany({ where: { apiKeyId: keyId } });
        if (req.body.modelIds.length) {
          await tx.apiKeyAllowedModel.createMany({
            data: req.body.modelIds.map(modelId => ({ apiKeyId: keyId, modelId }))
          });
        }
      }
      return tx.apiKey.update({ where: { id: keyId }, data });
    });
    
    return updated;
  });

  fastify.post<{ Params: { id: string } }>('/api/keys/:id/regenerate', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const keyId = parseInt(req.params.id);
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });

    if (!key) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    if (req.user.role !== 'ADMIN' && key.userId !== req.user.id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const rawKey = generateApiKey();
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { keyHash: hashKey(rawKey) }
    });

    return {
      id: key.id,
      key: rawKey,
      name: key.name,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt?.toISOString()
    };
  });

  fastify.delete<{ Params: { id: string } }>('/api/keys/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const keyId = parseInt(req.params.id);
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    
    if (!key) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    
    if (req.user.role !== 'ADMIN' && key.userId !== req.user.id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await prisma.apiKey.delete({ where: { id: keyId } });
    return { success: true };
  });

  fastify.get<{ Params: { id: string } }>('/api/keys/:id/stats', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const keyId = parseInt(req.params.id);
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });

    if (!key) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    if (req.user.role !== 'ADMIN' && key.userId !== req.user.id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [total, todayUsage, monthlyModels] = await Promise.all([
      prisma.usageRecord.aggregate({
        where: { apiKeyId: keyId },
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true },
        _count: true
      }),
      prisma.usageRecord.aggregate({
        where: { apiKeyId: keyId, createdAt: { gte: today } },
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true },
        _count: true
      }),
      prisma.usageRecord.groupBy({
        by: ['model'],
        where: { apiKeyId: keyId, createdAt: { gte: monthStart } },
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true },
        orderBy: { _sum: { cost: 'desc' } },
        take: 10
      })
    ]);

    const shape = (u: { _count: number; _sum: { tokensIn: number | null; tokensOut: number | null; cachedTokens: number | null; cost: unknown } }) => ({
      requests: u._count,
      tokensIn: u._sum.tokensIn || 0,
      tokensOut: u._sum.tokensOut || 0,
      cachedTokens: u._sum.cachedTokens || 0,
      cost: Number(u._sum.cost || 0)
    });

    return {
      keyId,
      name: key.name,
      total: shape(total),
      today: shape(todayUsage),
      monthlyModels: monthlyModels.map(m => ({
        model: m.model,
        tokensIn: m._sum.tokensIn || 0,
        tokensOut: m._sum.tokensOut || 0,
        cachedTokens: m._sum.cachedTokens || 0,
        cost: Number(m._sum.cost || 0)
      }))
    };
  });
}