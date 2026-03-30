import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CreateUserBody {
  email: string;
  password: string;
  name: string;
  role?: 'ADMIN' | 'USER';
}

interface UpdateUserBody {
  email?: string;
  name?: string;
  role?: 'ADMIN' | 'USER';
  balance?: number;
}

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get('/api/users', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, balance: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    return users;
  });

  fastify.post<{ Body: CreateUserBody }>('/api/users', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { email, password, name, role = 'USER' } = req.body;
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(400).send({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true }
    });
    
    return user;
  });

  fastify.put<{ Params: { id: string }, Body: UpdateUserBody }>('/api/users/:id', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const userId = parseInt(req.params.id);
    const { email, name, role, balance } = req.body;

    const data: any = {};
    if (email) data.email = email;
    if (name) data.name = name;
    if (role) data.role = role;
    if (balance !== undefined) data.balance = balance;

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true, balance: true }
    });
    
    return user;
  });

  fastify.delete('/api/users/:id', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const userId = parseInt(req.params.id);
    await prisma.user.delete({ where: { id: userId } });
    return { success: true };
  });
}