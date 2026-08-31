import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthData } from './auth.js';

export async function quotaCheck(req: FastifyRequest, reply: FastifyReply) {
  const authData = (req as any).authData as AuthData | undefined;
  if (!authData) return;

  const monthTokens = authData.monthTokens ?? 0;
  const todayTokens = authData.todayTokens ?? 0;

  if ((authData.monthlyQuota ?? 0) > 0 && monthTokens >= authData.monthlyQuota) {
    return reply.status(429).send({
      error: {
        message: `Monthly quota exceeded (${monthTokens} / ${authData.monthlyQuota} tokens)`,
        type: 'rate_limit_error',
        code: 'monthly_quota_exceeded'
      }
    });
  }

  if ((authData.dailyQuota ?? 0) > 0 && todayTokens >= authData.dailyQuota) {
    return reply.status(429).send({
      error: {
        message: `Daily quota exceeded (${todayTokens} / ${authData.dailyQuota} tokens)`,
        type: 'rate_limit_error',
        code: 'daily_quota_exceeded'
      }
    });
  }

  const modelMonthTokens = authData.modelMonthTokens ?? 0;
  const modelTodayTokens = authData.modelTodayTokens ?? 0;

  if ((authData.modelMonthlyQuota ?? 0) > 0 && modelMonthTokens >= authData.modelMonthlyQuota!) {
    return reply.status(429).send({
      error: {
        message: `Monthly model quota exceeded (${modelMonthTokens} / ${authData.modelMonthlyQuota} tokens)`,
        type: 'rate_limit_error',
        code: 'monthly_model_quota_exceeded'
      }
    });
  }

  if ((authData.modelDailyQuota ?? 0) > 0 && modelTodayTokens >= authData.modelDailyQuota!) {
    return reply.status(429).send({
      error: {
        message: `Daily model quota exceeded (${modelTodayTokens} / ${authData.modelDailyQuota} tokens)`,
        type: 'rate_limit_error',
        code: 'daily_model_quota_exceeded'
      }
    });
  }

  if ((authData.userBalance ?? 0) <= 0) {
    return reply.status(402).send({
      error: {
        message: 'Insufficient balance',
        type: 'insufficient_funds',
        code: 'insufficient_balance'
      }
    });
  }
}
