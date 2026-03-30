import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface VerifyBody {
  apiKey: string;
}

interface ReportBody {
  apiKey: string;
  providerId: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  latencyMs: number;
}

async function verifyKey(apiKey: string) {
  const keys = await prisma.apiKey.findMany({
    where: { status: 'ACTIVE' },
    include: { user: true }
  });

  for (const key of keys) {
    if (bcrypt.compareSync(apiKey, key.keyHash)) {
      if (key.expiresAt && key.expiresAt < new Date()) {
        return { valid: false, reason: 'Key expired' };
      }
      return {
        valid: true,
        keyId: key.id,
        userId: key.userId,
        rateLimit: key.rateLimit,
        dailyQuota: key.dailyQuota,
        monthlyQuota: key.monthlyQuota,
        userBalance: key.user.balance
      };
    }
  }
  return { valid: false, reason: 'Invalid key' };
}

export async function internalRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: VerifyBody }>('/internal/keys/verify', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Invalid internal secret' });
    }

    const result = await verifyKey(req.body.apiKey);
    if (!result.valid) {
      return reply.status(401).send({ error: result.reason });
    }
    return result;
  });

  fastify.post<{ Body: ReportBody }>('/internal/usage/report', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Invalid internal secret' });
    }

    const { apiKey, providerId, model, tokensIn, tokensOut, cost, latencyMs } = req.body;
    const verifyResult = await verifyKey(apiKey);
    
    if (!verifyResult.valid) {
      return reply.status(401).send({ error: 'Invalid key' });
    }

    await prisma.usageRecord.create({
      data: {
        apiKeyId: verifyResult.keyId,
        providerId,
        model,
        tokensIn,
        tokensOut,
        cost,
        latencyMs
      }
    });

    await prisma.user.update({
      where: { id: verifyResult.userId },
      data: {
        balance: { decrement: cost }
      }
    });

    return { success: true };
  });

  fastify.get('/internal/usage/daily/:keyId', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Invalid internal secret' });
    }

    const keyId = parseInt(req.params.keyId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usage = await prisma.usageRecord.aggregate({
      where: {
        apiKeyId: keyId,
        createdAt: { gte: today }
      },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        cost: true
      }
    });

    return {
      tokensIn: usage._sum.tokensIn || 0,
      tokensOut: usage._sum.tokensOut || 0,
      cost: usage._sum.cost || 0
    };
  });

  fastify.get('/internal/usage/monthly/:keyId', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Invalid internal secret' });
    }

    const keyId = parseInt(req.params.keyId);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const usage = await prisma.usageRecord.aggregate({
      where: {
        apiKeyId: keyId,
        createdAt: { gte: monthStart }
      },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        cost: true
      }
    });

    return {
      tokensIn: usage._sum.tokensIn || 0,
      tokensOut: usage._sum.tokensOut || 0,
      cost: usage._sum.cost || 0
    };
  });
}