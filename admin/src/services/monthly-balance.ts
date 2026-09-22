import type { PrismaClient } from '@prisma/client';

/** 每月额度(元); SSO_MONTHLY_BALANCE 可覆盖 */
export const MONTHLY_BALANCE = Number(process.env.SSO_MONTHLY_BALANCE ?? 100);

/**
 * 跨月重置: 余额回到月度额度并记一笔 RECHARGE 流水。
 * 由热路径调用 —— 只在月份变化时写库, 平时零开销。
 * 仅员工账号(有工号)参与月度额度; 管理员等内部账号不动余额。
 */
export async function ensureMonthlyBalance<
  T extends { id: number; balance: unknown; balanceResetAt: Date | null; employeeId?: string | null } | null
>(prisma: PrismaClient, user: T): Promise<T> {
  if (!user) return user;
  // 仅员工账号(有工号)参与月度额度; 管理员等内部账号不动余额
  if (!user.employeeId) return user;
  const now = new Date();
  const last = user.balanceResetAt ? new Date(user.balanceResetAt) : null;
  const stale =
    !last || last.getFullYear() !== now.getFullYear() || last.getMonth() !== now.getMonth();
  if (!stale) return user;
  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { balance: MONTHLY_BALANCE, balanceResetAt: now },
      select: { id: true, balance: true, balanceResetAt: true, employeeId: true }
    });
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'RECHARGE',
        amount: MONTHLY_BALANCE,
        balance: updated.balance,
        description: `每月额度重置(${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')})`
      }
    });
    return updated as unknown as T;
  } catch (err) {
    console.warn('[quota] 月度额度重置失败:', (err as Error).message);
    return user;
  }
}
