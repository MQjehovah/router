import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const providers = await prisma.provider.findMany({ include: { protocols: true } });
  const rows = providers
    .filter(p => !p.protocols.some(r => r.protocol === 'OPENAI_CHAT'))
    .map(p => ({ providerId: p.id, protocol: 'OPENAI_CHAT' as const, path: p.path || null }));

  if (rows.length > 0) {
    await prisma.providerProtocol.createMany({ data: rows, skipDuplicates: true });
  }
  console.log(`Seeded ${rows.length} OPENAI_CHAT protocol rows`);
}

main().finally(() => prisma.$disconnect());
