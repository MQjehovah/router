import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { WEAK_VALUES } from '../admin/src/env.ts';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const adminPassword = (process.env.ADMIN_PASSWORD ?? '').trim();
  if (!adminPassword || WEAK_VALUES.has(adminPassword)) {
    console.error('错误: 必须通过环境变量 ADMIN_PASSWORD 设置一个非弱口令的管理员密码(未配置或命中弱值清单)');
    process.exit(1);
  }
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
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());