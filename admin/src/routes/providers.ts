import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function encrypt(text: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key.slice(0, 32)), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

interface CreateProviderBody {
  name: string;
  type: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'HUGGINGFACE';
  baseUrl: string;
  apiKey: string;
}

interface UpdateProviderBody {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export async function providerRoutes(fastify: FastifyInstance) {
  fastify.get('/api/providers', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const providers = await prisma.provider.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return providers.map(p => ({
      ...p,
      apiKey: p.apiKey.substring(0, 8) + '****',
      createdAt: p.createdAt.toISOString()
    }));
  });

  fastify.post<{ Body: CreateProviderBody }>('/api/providers', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const encryptedKey = encrypt(req.body.apiKey, process.env.ENCRYPTION_KEY || 'default-key');
    
    const provider = await prisma.provider.create({
      data: {
        name: req.body.name,
        type: req.body.type,
        baseUrl: req.body.baseUrl,
        apiKey: encryptedKey
      }
    });

    return { ...provider, apiKey: req.body.apiKey };
  });

  fastify.put<{ Params: { id: string }, Body: UpdateProviderBody }>('/api/providers/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const providerId = parseInt(req.params.id);
    const data: any = {};

    if (req.body.name) data.name = req.body.name;
    if (req.body.baseUrl) data.baseUrl = req.body.baseUrl;
    if (req.body.status) data.status = req.body.status;
    if (req.body.apiKey) {
      data.apiKey = encrypt(req.body.apiKey, process.env.ENCRYPTION_KEY || 'default-key');
    }

    const provider = await prisma.provider.update({
      where: { id: providerId },
      data
    });

    return { ...provider, apiKey: '****' };
  });

  fastify.delete('/api/providers/:id', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const providerId = parseInt(req.params.id);
    await prisma.provider.delete({ where: { id: providerId } });
    return { success: true };
  });
}