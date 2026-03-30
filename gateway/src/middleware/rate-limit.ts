import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitCache = new Map<string, RateLimitEntry>();

function cleanExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of rateLimitCache.entries()) {
    if (entry.resetTime < now) {
      rateLimitCache.delete(key);
    }
  }
}

setInterval(cleanExpiredEntries, 60000);

export async function rateLimitMiddleware(fastify: FastifyInstance) {
  fastify.decorate('rateLimit', async (req: FastifyRequest, reply: FastifyReply) => {
    const authData = (req as any).authData;
    if (!authData) {
      return reply.status(401).send({
        error: {
          message: 'Authentication required',
          type: 'authentication_error'
        }
      });
    }

    const keyId = authData.keyId;
    const now = Date.now();
    const windowMs = 60000;
    const limit = authData.rateLimit;

    let entry = rateLimitCache.get(String(keyId));
    
    if (!entry || entry.resetTime < now) {
      entry = { count: 0, resetTime: now + windowMs };
      rateLimitCache.set(String(keyId), entry);
    }

    entry.count++;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({
        error: {
          message: `Rate limit exceeded. Limit: ${limit} requests per minute`,
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded'
        }
      });
    }

    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)));
  });
}