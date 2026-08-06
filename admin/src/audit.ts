import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuditEntry {
  actorId: number | null;
  action: string;
  targetType: string;
  targetId?: string | number;
  detail?: unknown;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId != null ? String(entry.targetId) : null,
        detail: entry.detail != null ? JSON.stringify(entry.detail) : null
      }
    });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}
