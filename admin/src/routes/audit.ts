import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuditQuery {
  page?: string;
  pageSize?: string;
  targetType?: string;
}

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: AuditQuery }>('/api/audit', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const page = Math.max(1, parseInt(req.query.page || '1') || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20') || 20));

    const where: any = {};
    if (req.query.targetType) where.targetType = req.query.targetType;

    const total = await prisma.auditLog.count({ where });
    const rows = await prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return {
      total,
      rows: rows.map(r => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        detail: r.detail ? JSON.parse(r.detail) : null,
        actor: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
        createdAt: r.createdAt.toISOString()
      }))
    };
  });
}
