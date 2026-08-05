import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PROTOCOLS } from '../protocols.js';

const prisma = new PrismaClient();

function encrypt(text: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key.slice(0, 32)), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string, key: string): string {
  const [ivHex, encrypted] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.slice(0, 32)), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function testProviderConnection(type: string, baseUrl: string, apiKey: string) {
  const base = baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const signal = controller.signal;

  const safeText = async (res: Response) => {
    const body = await res.text();
    return body.slice(0, 300);
  };

  try {
    let res: Response;
    switch (type) {
      case 'OPENAI':
        res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }, signal
        });
        break;
      case 'ANTHROPIC':
        res = await fetch(`${base}/models`, {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal
        });
        break;
      case 'GOOGLE':
        res = await fetch(`${base}/models?key=${encodeURIComponent(apiKey)}`, { signal });
        break;
      case 'HUGGINGFACE':
        res = await fetch(`${base}/api/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }, signal
        });
        break;
      case 'DEEPSEEK':
        res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }, signal
        });
        break;
      default:
        return { ok: false, status: 0, detail: `不支持的类型: ${type}` };
    }
    return { ok: res.ok, status: res.status, detail: res.ok ? '连接正常' : await safeText(res) };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      detail: err.name === 'AbortError' ? '连接超时（10s）' : `请求失败: ${err.message || err}`
    };
  } finally {
    clearTimeout(timer);
  }
}

interface CreateProviderBody {
  name: string;
  type: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'HUGGINGFACE' | 'DEEPSEEK';
  baseUrl: string;
  path?: string;
  apiKey: string;
}

interface UpdateProviderBody {
  name?: string;
  baseUrl?: string;
  path?: string;
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
      orderBy: { createdAt: 'desc' },
      include: { protocols: true }
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

    const provider = await prisma.$transaction(async (tx) => {
      const p = await tx.provider.create({
        data: {
          name: req.body.name,
          type: req.body.type,
          baseUrl: req.body.baseUrl,
          path: req.body.path || '/chat/completions',
          apiKey: encryptedKey
        }
      });

      await tx.providerProtocol.upsert({
        where: { providerId_protocol: { providerId: p.id, protocol: 'OPENAI_CHAT' } },
        create: { providerId: p.id, protocol: 'OPENAI_CHAT', path: req.body.path || null },
        update: {}
      });

      return p;
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
    if (req.body.path) data.path = req.body.path;
    if (req.body.status) data.status = req.body.status;
    if (req.body.apiKey) {
      data.apiKey = encrypt(req.body.apiKey, process.env.ENCRYPTION_KEY || 'default-key');
    }

    const provider = await prisma.provider.update({
      where: { id: providerId },
      data
    });

    if (req.body.path) {
      await prisma.providerProtocol.updateMany({
        where: { providerId, protocol: 'OPENAI_CHAT' },
        data: { path: req.body.path }
      });
    }

    return { ...provider, apiKey: '****' };
  });

  fastify.post<{ Params: { id: string } }>('/api/providers/:id/test', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const providerId = parseInt(req.params.id);
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      return reply.status(404).send({ error: 'Provider not found' });
    }

    const apiKey = decrypt(provider.apiKey, process.env.ENCRYPTION_KEY || 'default-key');
    const result = await testProviderConnection(provider.type, provider.baseUrl, apiKey);
    reply.code(result.ok ? 200 : 400);
    return result;
  });

  fastify.delete<{ Params: { id: string } }>('/api/providers/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const providerId = parseInt(req.params.id);
    await prisma.provider.delete({ where: { id: providerId } });
    return { success: true };
  });

  fastify.get<{ Params: { id: string } }>('/api/providers/:id/protocols', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    const providerId = parseInt(req.params.id);
    if (Number.isNaN(providerId)) return reply.status(400).send({ error: 'Invalid provider id' });
    const rows = await prisma.providerProtocol.findMany({
      where: { providerId },
      orderBy: { id: 'asc' }
    });
    return rows;
  });

  fastify.post<{ Params: { id: string }, Body: { protocol: string; path?: string } }>('/api/providers/:id/protocols', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    const providerId = parseInt(req.params.id);
    if (Number.isNaN(providerId)) return reply.status(400).send({ error: 'Invalid provider id' });
    const { protocol, path } = req.body;
    if (!protocol) return reply.status(400).send({ error: 'protocol is required' });
    if (!PROTOCOLS.includes(protocol as any)) return reply.status(400).send({ error: 'Invalid protocol' });
    const exists = await prisma.provider.findUnique({ where: { id: providerId }, select: { id: true } });
    if (!exists) return reply.status(404).send({ error: 'Provider not found' });
    const row = await prisma.providerProtocol.upsert({
      where: { providerId_protocol: { providerId, protocol: protocol as any } },
      create: { providerId, protocol: protocol as any, path: path || null },
      update: { path: path || null }
    });
    return row;
  });

  fastify.put<{ Params: { id: string; protocolId: string }, Body: { path?: string; status?: string } }>('/api/providers/:id/protocols/:protocolId', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    const protocolId = parseInt(req.params.protocolId);
    const providerId = parseInt(req.params.id);
    if (Number.isNaN(protocolId) || Number.isNaN(providerId)) return reply.status(400).send({ error: 'Invalid id' });
    if (req.body.status && !['ACTIVE', 'INACTIVE'].includes(req.body.status)) return reply.status(400).send({ error: 'Invalid status' });
    const data: any = {};
    if (req.body.path !== undefined) data.path = req.body.path || null;
    if (req.body.status) data.status = req.body.status;
    const result = await prisma.providerProtocol.updateMany({
      where: { id: protocolId, providerId },
      data
    });
    if (result.count === 0) return reply.status(404).send({ error: 'Protocol not found' });
    const row = await prisma.providerProtocol.findUnique({ where: { id: protocolId } });
    return row;
  });

  fastify.delete<{ Params: { id: string; protocolId: string } }>('/api/providers/:id/protocols/:protocolId', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    const protocolId = parseInt(req.params.protocolId);
    const providerId = parseInt(req.params.id);
    if (Number.isNaN(protocolId) || Number.isNaN(providerId)) return reply.status(400).send({ error: 'Invalid id' });
    const result = await prisma.providerProtocol.deleteMany({
      where: { id: protocolId, providerId }
    });
    if (result.count === 0) return reply.status(404).send({ error: 'Protocol not found' });
    return { success: true };
  });
}