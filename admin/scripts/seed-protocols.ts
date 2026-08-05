import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const providers = await prisma.provider.findMany({ include: { protocols: true } });
  let created = 0;
  for (const p of providers) {
    const has = p.protocols.some(r => r.protocol === 'OPENAI_CHAT');
    if (!has) {
      await prisma.providerProtocol.create({
        data: { providerId: p.id, protocol: 'OPENAI_CHAT', path: p.path || null }
      });
      created++;
    }
  }
  console.log(`Seeded ${created} OPENAI_CHAT protocol rows`);
}

main().finally(() => prisma.$disconnect());
