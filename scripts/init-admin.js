import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash,
      name: 'Admin',
      role: 'ADMIN',
      balance: 1000
    }
  });

  console.log('Admin user created:', admin.email);
  console.log('Password:', adminPassword);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());