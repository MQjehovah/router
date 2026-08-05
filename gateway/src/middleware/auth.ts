import { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthData {
  keyId: number;
  userId: number;
  rateLimit: number;
  dailyQuota: number;
  monthlyQuota: number;
  userBalance: number;
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  let apiKey = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  } else if (req.headers['x-api-key']) {
    apiKey = String(req.headers['x-api-key']);
  }

  if (!apiKey) {
    return reply.status(401).send({
      error: {
        message: 'Missing or invalid authorization header',
        type: 'authentication_error',
        code: 'missing_authorization'
      }
    });
  }
  const adminUrl = process.env.ADMIN_API_URL || 'http://localhost:3001';
  const secret = process.env.INTERNAL_SECRET || '';

  try {
    const response = await fetch(`${adminUrl}/internal/keys/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret
      },
      body: JSON.stringify({ apiKey })
    });

    if (!response.ok) {
      const error = await response.json();
      return reply.status(401).send({
        error: {
          message: error.error || 'Invalid API key',
          type: 'authentication_error',
          code: 'invalid_api_key'
        }
      });
    }

    const authData: AuthData = await response.json();
    (req as any).authData = authData;
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({
      error: {
        message: 'Failed to verify API key',
        type: 'internal_error',
        code: 'verification_failed'
      }
    });
  }
}