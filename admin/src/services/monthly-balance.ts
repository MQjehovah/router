import type { PrismaClient } from '@prisma/client';

/** 每月额度(元); SSO_MONTHLY_BALANCE 可覆盖 */
export const MONTHLY_BALANCE = Number(process.env.SSO_MONTHLY_BALANCE ?? 100);

const BALANCE_SELECT = { id: true, balance: true, balanceResetAt: true, employeeId: true } as const;

/**
 * 跨月重置: 余额回到月度额度并记一笔 RECHARGE 流水。
 * 由热路径调用 —— 只在月份变化时写库, 平时零开销。
 * 仅员工账号(有工号)参与月度额度; 管理员等内部账号不动余额。
 *
 * 并发幂等: 先用「balanceResetAt 早于本月起点」为条件 updateMany, 命中(真正跨月的调用)才建流水,
 * 月初并发调用因此不会重复写 RECHARGE。已知边界: updateMany 与 create 非同一事务,
 * 极端崩溃窗口可能余额已重置但缺流水(balanceResetAt 已推进, 不会重复重置或重复写流水)。
 */
export async function ensureMonthlyBalance<
  T extends { id: number; balance: unknown; balanceResetAt: Date | null; employeeId?: string | null } | null
>(prisma: PrismaClient, user: T): Promise<T> {
  if (!user) return user;
  // 仅员工账号(有工号)参与月度额度; 管理员等内部账号不动余额
  if (!user.employeeId) return user;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = user.balanceResetAt ? new Date(user.balanceResetAt) : null;
  const stale =
    !last || last.getFullYear() !== now.getFullYear() || last.getMonth() !== now.getMonth();
  if (!stale) return user;
  try {
    // 条件更新: 仅当库中 balanceResetAt 仍缺失或早于本月起点时才命中;
    // 并发中的第二个调用会命中 0 行, 直接复用已重置的结果
    const hit = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ balanceResetAt: null }, { balanceResetAt: { lt: monthStart } }]
      },
      data: { balance: MONTHLY_BALANCE, balanceResetAt: now }
    });
    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: BALANCE_SELECT
    });
    if (!current) return user;
    if (hit.count === 0) {
      // 已被并发调用重置: 不重复写流水, 返回最新余额
      return current as unknown as T;
    }
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'RECHARGE',
        amount: MONTHLY_BALANCE,
        balance: current.balance,
        description: `每月额度重置(${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')})`
      }
    });
    return current as unknown as T;
  } catch (err) {
    console.warn('[quota] 月度额度重置失败:', (err as Error).message);
    return user;
  }
}
