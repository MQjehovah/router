import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface LoginBody {
  email: string;
  password: string;
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: LoginBody }>('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role
    });

    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  fastify.get('/api/auth/me', {
    preHandler: [fastify.authenticate]
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true, balance: true }
    });
    return user;
  });

  fastify.post('/api/auth/logout', async () => {
    return { success: true };
  });

  interface ChangePasswordBody {
    currentPassword: string;
    newPassword: string;
  }

  fastify.put<{ Body: ChangePasswordBody }>('/api/auth/password', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return reply.status(400).send({ error: 'New password must be at least 6 characters' });
    }
    if (newPassword === currentPassword) {
      return reply.status(400).send({ error: 'New password must differ from current password' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return reply.status(400).send({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    return { success: true };
  });
}