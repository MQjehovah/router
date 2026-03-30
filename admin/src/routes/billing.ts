import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RechargeBody {
  amount: number;
  description?: string;
}

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get('/api/bills', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };

    const bills = await prisma.bill.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    });

    return bills;
  });

  fastify.get('/api/transactions', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };

    const transactions = await prisma.transaction.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return transactions;
  });

  fastify.post<{ Body: RechargeBody }>('/api/transactions/recharge', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const amount = Number(req.body.amount);
    if (amount <= 0) {
      return reply.status(400).send({ error: 'Invalid amount' });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { balance: { increment: amount } }
    });

    await prisma.transaction.create({
      data: {
        userId: req.user.id,
        type: 'RECHARGE',
        amount,
        balance: user.balance,
        description: req.body.description || 'Balance recharge'
      }
    });

    return { success: true, balance: user.balance };
  });
}