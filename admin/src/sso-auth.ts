import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { extractEmployeeId, verifySsoToken } from './oidc.js';

/// 员工端 dashboard 用 SSO 交换来的 router token 访问用户态接口的鉴权钩子：
/// 无 token/验签失败 → 401；token 无工号或用户未开通 → 403；通过后把用户挂到 req.ssoUser。
/// 以工厂形式导出，便于测试挂真实 JWKS 端到端覆盖各分支（index.ts 在 decorate 时装配）。
export function createAuthenticateSso(prisma: PrismaClient) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = String(req.headers.authorization ?? '');
    if (!auth.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
    try {
      const claims = await verifySsoToken(auth.slice(7));
      const employeeId = extractEmployeeId(claims);
      if (!employeeId) {
        reply.status(403).send({ error: 'Forbidden' });
        return;
      }
      const user = await prisma.user.findUnique({ where: { employeeId } });
      if (!user) {
        reply.status(403).send({ error: 'Forbidden', detail: '用户未开通' });
        return;
      }
      req.ssoUser = user;
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  };
}
