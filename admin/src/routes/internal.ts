import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { keyVerifyCache, KeyVerifyResult } from '../key-cache.js';
import { effectiveProtocolPath, DEFAULT_PROTOCOL_PATHS } from '../protocols.js';

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
  model?: string;
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

async function verifyKey(apiKey: string): Promise<KeyVerifyResult> {
  const cached = keyVerifyCache.get(apiKey);
  if (cached) return cached;

  const result = await doVerify(apiKey);
  keyVerifyCache.set(apiKey, result);
  return result;
}

async function doVerify(apiKey: string): Promise<KeyVerifyResult> {
  const keys = await prisma.apiKey.findMany({
    where: { status: 'ACTIVE' }
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
        dailyQuota: Number(key.dailyQuota),
        monthlyQuota: Number(key.monthlyQuota)
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [user, todayUsage, monthUsage] = await Promise.all([
      prisma.user.findUnique({ where: { id: result.userId }, select: { balance: true } }),
      prisma.usageRecord.aggregate({
        where: { apiKeyId: result.keyId, createdAt: { gte: today } },
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true }
      }),
      prisma.usageRecord.aggregate({
        where: { apiKeyId: result.keyId, createdAt: { gte: monthStart } },
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true }
      })
    ]);

    const sumTokens = (u: { _sum: { tokensIn: number | null; tokensOut: number | null; cachedTokens: number | null } }) =>
      (u._sum.tokensIn || 0) + (u._sum.tokensOut || 0) + (u._sum.cachedTokens || 0);

    let modelDailyQuota = 0;
    let modelMonthlyQuota = 0;
    let modelTodayTokens = 0;
    let modelMonthTokens = 0;

    if (req.body.model) {
      const model = await prisma.model.findUnique({ where: { name: req.body.model } });
      if (model) {
        const grant = await prisma.apiKeyAllowedModel.findUnique({
          where: { apiKeyId_modelId: { apiKeyId: result.keyId, modelId: model.id } }
        });
        if (grant) {
          modelDailyQuota = Number(grant.dailyQuota);
          modelMonthlyQuota = Number(grant.monthlyQuota);
          const [mToday, mMonth] = await Promise.all([
            prisma.usageRecord.aggregate({
              where: { apiKeyId: result.keyId, model: req.body.model, createdAt: { gte: today } },
              _sum: { tokensIn: true, tokensOut: true, cachedTokens: true }
            }),
            prisma.usageRecord.aggregate({
              where: { apiKeyId: result.keyId, model: req.body.model, createdAt: { gte: monthStart } },
              _sum: { tokensIn: true, tokensOut: true, cachedTokens: true }
            })
          ]);
          modelTodayTokens = sumTokens(mToday);
          modelMonthTokens = sumTokens(mMonth);
        }
      }
    }

    return {
      keyId: result.keyId,
      userId: result.userId,
      rateLimit: result.rateLimit,
      dailyQuota: result.dailyQuota,
      monthlyQuota: result.monthlyQuota,
      userBalance: Number(user?.balance ?? 0),
      todayTokens: sumTokens(todayUsage),
      monthTokens: sumTokens(monthUsage),
      modelDailyQuota,
      modelMonthlyQuota,
      modelTodayTokens,
      modelMonthTokens
    };
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

    const protoRows = await prisma.providerProtocol.findMany({
      where: { providerId: model.providerId },
      orderBy: { id: 'asc' }
    });

    const activeRows = protoRows.filter(r => r.status === 'ACTIVE');

    let protocols = activeRows.map(r => ({
      protocol: r.protocol,
      path: effectiveProtocolPath(r.protocol, r.path)
    }));

    if (protoRows.length === 0) {
      protocols = [{
        protocol: 'OPENAI_CHAT',
        path: effectiveProtocolPath('OPENAI_CHAT', model.provider.path)
      }];
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
      path: model.provider.path || DEFAULT_PROTOCOL_PATHS.OPENAI_CHAT,
      protocols,
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