import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function decrypt(text: string, key: string): string {
  const [ivHex, encrypted] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.slice(0, 32)), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function authTypeFor(type: string): string {
  switch (type) {
    case 'ANTHROPIC': return 'anthropic';
    case 'GOOGLE': return 'google';
    default: return 'bearer';
  }
}

interface VerifyBody {
  apiKey: string;
}

interface ReportBody {
  apiKey: string;
  providerId: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  cost: number;
  latencyMs: number;
}

async function verifyKey(apiKey: string): Promise<
  | { valid: true; keyId: number; userId: number; rateLimit: number; dailyQuota: number; monthlyQuota: number; userBalance: Prisma.Decimal }
  | { valid: false; reason: string }
> {
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

  fastify.post<{ Body: { apiKey: string } }>('/internal/keys/models', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Invalid internal secret' });
    }

    const result = await verifyKey(req.body.apiKey);
    if (!result.valid) {
      return reply.status(401).send({ error: result.reason });
    }

    const keyId = result.keyId;
    const grants = await prisma.apiKeyAllowedModel.findMany({
      where: { apiKeyId: keyId },
      include: { model: { include: { provider: true } } }
    });

    let models;
    if (grants.length > 0) {
      models = grants
        .filter(g => g.model.status === 'ACTIVE' && g.model.provider.status === 'ACTIVE')
        .map(g => g.model.name);
    } else {
      models = (await prisma.model.findMany({
        where: { status: 'ACTIVE' },
        include: { provider: true }
      }))
        .filter(m => m.provider.status === 'ACTIVE')
        .map(m => m.name);
    }

    return { models };
  });

  fastify.post<{ Body: { apiKey: string; model: string } }>('/internal/models/resolve', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Invalid internal secret' });
    }

    const result = await verifyKey(req.body.apiKey);
    if (!result.valid) {
      return reply.status(401).send({ error: result.reason });
    }

    const model = await prisma.model.findUnique({
      where: { name: req.body.model },
      include: { provider: true }
    });

    if (!model || model.status !== 'ACTIVE') {
      return reply.status(404).send({ error: `Model not found: ${req.body.model}` });
    }
    if (model.provider.status !== 'ACTIVE') {
      return reply.status(400).send({ error: 'Provider inactive' });
    }

    const keyId = result.keyId;
    const grant = await prisma.apiKeyAllowedModel.findUnique({
      where: { apiKeyId_modelId: { apiKeyId: keyId, modelId: model.id } }
    });
    const hasGrant = !!grant;
    const hasAnyGrant = (await prisma.apiKeyAllowedModel.count({ where: { apiKeyId: keyId } })) > 0;
    if (hasAnyGrant && !hasGrant) {
      return reply.status(403).send({ error: `Key not allowed to use model: ${req.body.model}` });
    }

    const providerKey = decrypt(model.provider.apiKey, process.env.ENCRYPTION_KEY || 'default-key');

    return {
      model: model.name,
      providerType: model.provider.type,
      pricing: {
        inputPrice: model.inputPrice.toNumber(),
        outputPrice: model.outputPrice.toNumber(),
        cachePrice: model.cachePrice.toNumber()
      },
      providerId: model.providerId,
      baseUrl: model.provider.baseUrl,
      path: model.provider.path || '/chat/completions',
      authType: authTypeFor(model.provider.type),
      apiKey: providerKey
    };
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
        cachedTokens: req.body.cachedTokens ?? 0,
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

  fastify.get<{ Params: { keyId: string } }>('/internal/usage/daily/:keyId', async (req, reply) => {
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

  fastify.get<{ Params: { keyId: string } }>('/internal/usage/monthly/:keyId', async (req, reply) => {
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