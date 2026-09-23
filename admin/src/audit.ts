import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuditEntry {
  actorId: number | null;
  action: string;
  targetType: string;
  targetId?: string | number;
  detail?: unknown;
}

/// 写审计日志; db 可注入(与 fastify.prisma 装配一致), 默认用模块级客户端
export async function writeAudit(entry: AuditEntry, db: PrismaClient = prisma): Promise<void> {
  try {
    await db.auditLog.create({
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
