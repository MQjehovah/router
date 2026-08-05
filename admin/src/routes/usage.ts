import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function usageRoutes(fastify: FastifyInstance) {
  fastify.get('/api/usage/stats', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const where = req.user.role === 'ADMIN' ? {} : { apiKey: { userId: req.user.id } };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalUsage, todayUsage, topModels] = await Promise.all([
      prisma.usageRecord.aggregate({
        where,
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true },
        _count: true
      }),
      prisma.usageRecord.aggregate({
        where: { ...where, createdAt: { gte: today } },
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true },
        _count: true
      }),
      prisma.usageRecord.groupBy({
        by: ['model'],
        where: {
          ...where,
          createdAt: { gte: new Date(today.getFullYear(), today.getMonth(), 1) }
        },
        _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true },
        orderBy: { _sum: { cost: 'desc' } },
        take: 10
      })
    ]);

    return {
      total: {
        requests: totalUsage._count,
        tokensIn: totalUsage._sum.tokensIn || 0,
        tokensOut: totalUsage._sum.tokensOut || 0,
        cachedTokens: totalUsage._sum.cachedTokens || 0,
        cost: totalUsage._sum.cost || 0
      },
      today: {
        requests: todayUsage._count,
        tokensIn: todayUsage._sum.tokensIn || 0,
        tokensOut: todayUsage._sum.tokensOut || 0,
        cachedTokens: todayUsage._sum.cachedTokens || 0,
        cost: todayUsage._sum.cost || 0
      },
      monthly: topModels.map(m => ({
        model: m.model,
        tokensIn: m._sum.tokensIn || 0,
        tokensOut: m._sum.tokensOut || 0,
        cachedTokens: m._sum.cachedTokens || 0,
        cost: m._sum.cost || 0
      }))
    };
  });

  fastify.get<{ Querystring: { limit?: string; offset?: string } }>('/api/usage/records', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const where = req.user.role === 'ADMIN' ? {} : { apiKey: { userId: req.user.id } };
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const records = await prisma.usageRecord.findMany({
      where,
      include: {
        apiKey: { select: { name: true } },
        provider: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    const total = await prisma.usageRecord.count({ where });

    return { records, total };
  });

  fastify.get<{ Querystring: { days?: string } }>('/api/usage/trend', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 30);
    const where = req.user.role === 'ADMIN' ? {} : { apiKey: { userId: req.user.id } };

    const now = new Date();
    const start = new Date(now.getTime() - (days - 1) * 86400000);
    start.setHours(0, 0, 0, 0);

    const grouped = await prisma.usageRecord.groupBy({
      by: ['createdAt'],
      where: { ...where, createdAt: { gte: start } },
      _sum: { tokensIn: true, tokensOut: true, cost: true },
      _count: true
    });

    const byDay = new Map<string, { requests: number; tokens: number; cost: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { requests: 0, tokens: 0, cost: 0 });
    }

    for (const g of grouped) {
      const key = g.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(key);
      if (entry) {
        entry.requests += g._count;
        entry.tokens += (g._sum.tokensIn || 0) + (g._sum.tokensOut || 0);
        entry.cost += Number(g._sum.cost || 0);
      }
    }

    return [...byDay.entries()].map(([date, v]) => ({ date, ...v }));
  });
}