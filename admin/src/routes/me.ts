import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { requireSsoUser } from '../sso-auth.js';
import {
  ensureUserKey,
  SSO_KEY_NAME,
  DEFAULT_RATE_LIMIT,
  DEFAULT_DAILY_QUOTA,
  DEFAULT_MONTHLY_QUOTA
} from '../services/user-key.js';
import { ensureMonthlyBalance } from '../services/monthly-balance.js';

/** 路由内优先使用 index.ts 装配的共享客户端; 测试可注入替身 */
const prisma = new PrismaClient();

/** 按模型分解上限(与 dashboard 的 MAX_MODEL_BREAKDOWN 一致); 每模型用 groupBy 一次取回, 不随模型数放大 */
const MAX_MODEL_BREAKDOWN = 10;

/** 与 dashboard 的 UsageBucket / UsageModelRow / UsageSummary 字段一一对应 */
interface UsageBucket {
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  cost: number;
}

interface UsageModelRow {
  name: string;
  today: UsageBucket;
  month: UsageBucket;
  dailyQuota: number;
  monthlyQuota: number;
}

interface UsageSummary {
  balance: number;
  rateLimit: number;
  quota: { daily: number; monthly: number };
  today: UsageBucket;
  month: UsageBucket;
  models: UsageModelRow[];
  truncated: boolean;
  fetchedAt: string;
}

/** Prisma 聚合结果的最小形态(Decimal 用 unknown 承接, 经 Number 归一) */
interface AggSum {
  tokensIn: number | null;
  tokensOut: number | null;
  cachedTokens: number | null;
  cost: unknown;
}

function emptyBucket(): UsageBucket {
  return { tokensIn: 0, tokensOut: 0, tokens: 0, cost: 0 };
}

/// tokens = tokensIn + tokensOut + cachedTokens(与 internal verify 的 sumTokens 口径一致, 缓存命中计入总量),
/// tokensIn/tokensOut 本身不含缓存; cost 为聚合和
function toBucket(sum: AggSum | null | undefined): UsageBucket {
  const tokensIn = Number(sum?.tokensIn ?? 0) || 0;
  const tokensOut = Number(sum?.tokensOut ?? 0) || 0;
  const cachedTokens = Number(sum?.cachedTokens ?? 0) || 0;
  return {
    tokensIn,
    tokensOut,
    tokens: tokensIn + tokensOut + cachedTokens,
    cost: Number(sum?.cost ?? 0) || 0
  };
}

export async function meRoutes(fastify: FastifyInstance) {
  fastify.get('/api/me/usage', { preHandler: [fastify.authenticateSso] }, async (req): Promise<UsageSummary> => {
    const db = fastify.prisma ?? prisma;
    const user = requireSsoUser(req);

    // 与旧链路(/internal/keys/verify)一致: 先跑跨月余额重置(仅员工账号; 同月幂等无写), 再用重置后的余额组装响应
    const account = await db.user.findUnique({
      where: { id: user.id },
      select: { id: true, balance: true, balanceResetAt: true, employeeId: true }
    });
    const current = await ensureMonthlyBalance(db, account);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 归属范围: 与 ensureUserKey 的查找一致(只看该用户的 sso key); 绝不创建/轮换
    const ssoKey = await db.apiKey.findFirst({
      where: { userId: user.id, name: SSO_KEY_NAME, status: 'ACTIVE', deletedAt: null },
      orderBy: { id: 'desc' }
    });

    let today = emptyBucket();
    let month = emptyBucket();
    let modelRows: UsageModelRow[] = [];

    if (ssoKey) {
      // 总量口径与 internal.ts verify 一致: 按该 key 的 usageRecord 聚合(缓存命中计入 tokens)
      const [todaySum, monthSum] = await Promise.all([
        db.usageRecord.aggregate({
          where: { apiKeyId: ssoKey.id, createdAt: { gte: todayStart } },
          _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true }
        }),
        db.usageRecord.aggregate({
          where: { apiKeyId: ssoKey.id, createdAt: { gte: monthStart } },
          _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true }
        })
      ]);
      today = toBucket(todaySum._sum);
      month = toBucket(monthSum._sum);

      // 模型清单规则同 /internal/keys/models: 有授权取授权 ACTIVE 模型, 无授权取全部 ACTIVE
      const grants = await db.apiKeyAllowedModel.findMany({
        where: { apiKeyId: ssoKey.id },
        include: { model: { include: { provider: true } } }
      });

      if (grants.length > 0) {
        const listed = grants.filter((g) => g.model.status === 'ACTIVE' && g.model.provider.status === 'ACTIVE');
        // 每模型用量一次 groupBy 取回, 不做逐模型查询(模型数另有 ≤10 上限)
        const [todayByModel, monthByModel] = await Promise.all([
          db.usageRecord.groupBy({
            by: ['model'],
            where: { apiKeyId: ssoKey.id, createdAt: { gte: todayStart } },
            _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true }
          }),
          db.usageRecord.groupBy({
            by: ['model'],
            where: { apiKeyId: ssoKey.id, createdAt: { gte: monthStart } },
            _sum: { tokensIn: true, tokensOut: true, cachedTokens: true, cost: true }
          })
        ]);
        const todayMap = new Map(todayByModel.map((r) => [r.model, toBucket(r._sum)]));
        const monthMap = new Map(monthByModel.map((r) => [r.model, toBucket(r._sum)]));
        modelRows = listed.map((g) => ({
          name: g.model.name,
          today: todayMap.get(g.model.name) ?? emptyBucket(),
          month: monthMap.get(g.model.name) ?? emptyBucket(),
          dailyQuota: Number(g.dailyQuota),
          monthlyQuota: Number(g.monthlyQuota)
        }));
      } else {
        // 无授权: internal verify 仅在授权存在时计算模型配额与用量, 故模型行统一为 0
        const activeModels = await db.model.findMany({
          where: { status: 'ACTIVE' },
          include: { provider: true }
        });
        modelRows = activeModels
          .filter((m) => m.provider.status === 'ACTIVE')
          .map((m) => ({
            name: m.name,
            today: emptyBucket(),
            month: emptyBucket(),
            dailyQuota: 0,
            monthlyQuota: 0
          }));
      }
    }
    // 无 key: 无用量也无模型归属, today/month 全 0, quota 用默认值

    // 截断前先排序, 保证展示的是本月消耗最大的模型: cost desc → tokens desc → name asc
    modelRows.sort(
      (a, b) =>
        b.month.cost - a.month.cost ||
        b.month.tokens - a.month.tokens ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );

    const truncated = modelRows.length > MAX_MODEL_BREAKDOWN;

    return {
      balance: Number(current?.balance ?? user.balance),
      rateLimit: ssoKey ? ssoKey.rateLimit : DEFAULT_RATE_LIMIT,
      quota: {
        daily: ssoKey ? Number(ssoKey.dailyQuota) : DEFAULT_DAILY_QUOTA,
        monthly: ssoKey ? Number(ssoKey.monthlyQuota) : DEFAULT_MONTHLY_QUOTA
      },
      today,
      month,
      models: modelRows.slice(0, MAX_MODEL_BREAKDOWN),
      truncated,
      fetchedAt: new Date().toISOString()
    };
  });

  fastify.get('/api/me/key', { preHandler: [fastify.authenticateSso] }, async (req) => {
    const user = requireSsoUser(req);
    const ensured = await ensureUserKey(fastify.prisma ?? prisma, user.id);
    return {
      ...ensured,
      employeeId: user.employeeId,
      name: user.name,
      email: user.email
    };
  });
}
