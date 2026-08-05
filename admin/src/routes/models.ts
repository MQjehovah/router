import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CreateModelBody {
  name: string;
  providerId: number;
  inputPrice?: number;
  outputPrice?: number;
  cachePrice?: number;
}

interface UpdateModelBody {
  name?: string;
  providerId?: number;
  status?: 'ACTIVE' | 'INACTIVE';
  inputPrice?: number;
  outputPrice?: number;
  cachePrice?: number;
}

function isValidPrice(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function serializeModel(m: any) {
  return {
    id: m.id,
    name: m.name,
    status: m.status,
    providerId: m.providerId,
    inputPrice: m.inputPrice.toNumber(),
    outputPrice: m.outputPrice.toNumber(),
    cachePrice: m.cachePrice.toNumber(),
    provider: m.provider,
    createdAt: m.createdAt.toISOString()
  };
}

export async function modelRoutes(fastify: FastifyInstance) {
  fastify.get('/api/models', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const models = await prisma.model.findMany({
      include: { provider: { select: { id: true, name: true, type: true, baseUrl: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return models.map(serializeModel);
  });

  fastify.post<{ Body: CreateModelBody }>('/api/models', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const provider = await prisma.provider.findUnique({ where: { id: req.body.providerId } });
    if (!provider) {
      return reply.status(400).send({ error: 'Provider not found' });
    }

    const existing = await prisma.model.findUnique({ where: { name: req.body.name } });
    if (existing) {
      return reply.status(400).send({ error: 'Model already exists' });
    }

    for (const key of ['inputPrice', 'outputPrice', 'cachePrice'] as const) {
      const v = req.body[key];
      if (v !== undefined && !isValidPrice(v)) {
        return reply.status(400).send({ error: `Invalid price: ${key}` });
      }
    }

    const model = await prisma.model.create({
      data: {
        name: req.body.name,
        providerId: req.body.providerId,
        inputPrice: req.body.inputPrice ?? 0,
        outputPrice: req.body.outputPrice ?? 0,
        cachePrice: req.body.cachePrice ?? 0
      }
    });
    return serializeModel(model);
  });

  fastify.put<{ Params: { id: string }, Body: UpdateModelBody }>('/api/models/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const modelId = parseInt(req.params.id);
    const data: any = {};
    if (req.body.name) data.name = req.body.name;
    if (req.body.providerId) {
      const provider = await prisma.provider.findUnique({ where: { id: req.body.providerId } });
      if (!provider) return reply.status(400).send({ error: 'Provider not found' });
      data.providerId = req.body.providerId;
    }
    if (req.body.status) data.status = req.body.status;
    for (const key of ['inputPrice', 'outputPrice', 'cachePrice'] as const) {
      const v = req.body[key];
      if (v !== undefined && !isValidPrice(v)) {
        return reply.status(400).send({ error: `Invalid price: ${key}` });
      }
    }
    if (typeof req.body.inputPrice === 'number') data.inputPrice = req.body.inputPrice;
    if (typeof req.body.outputPrice === 'number') data.outputPrice = req.body.outputPrice;
    if (typeof req.body.cachePrice === 'number') data.cachePrice = req.body.cachePrice;

    const model = await prisma.model.update({ where: { id: modelId }, data });
    return serializeModel(model);
  });

  fastify.delete<{ Params: { id: string } }>('/api/models/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const modelId = parseInt(req.params.id);
    await prisma.apiKeyAllowedModel.deleteMany({ where: { modelId } });
    await prisma.model.delete({ where: { id: modelId } });
    return { success: true };
  });
}
