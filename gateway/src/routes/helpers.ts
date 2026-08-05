import { FastifyInstance, FastifyRequest } from 'fastify';

export interface ProtocolPath {
  protocol: string;
  path: string;
}

export interface ResolvedProvider {
  model: string;
  providerId: number;
  baseUrl: string;
  path: string;
  protocols?: ProtocolPath[];
  authType: string;
  apiKey: string;
  providerType: string;
  pricing: { inputPrice: number; outputPrice: number; cachePrice: number };
}

export function extractApiKey(req: FastifyRequest): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  const xk = req.headers['x-api-key'];
  return typeof xk === 'string' ? xk : '';
}

export async function resolveProvider(req: FastifyRequest, model: string): Promise<{ ok: true; config: ResolvedProvider } | { ok: false; status: number; body: any }> {
  const adminUrl = process.env.ADMIN_API_URL || 'http://localhost:3001';
  const secret = process.env.INTERNAL_SECRET || '';
  const apiKey = extractApiKey(req);

  try {
    const response = await fetch(`${adminUrl}/internal/models/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret
      },
      body: JSON.stringify({ apiKey, model })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `Resolve failed: ${response.status}` }));
      return { ok: false, status: response.status, body: err };
    }
    const config: ResolvedProvider = await response.json();
    return { ok: true, config };
  } catch (err) {
    req.log.error(err);
    return {
      ok: false,
      status: 500,
      body: { error: { message: 'Failed to resolve model', type: 'internal_error', code: 'resolve_failed' } }
    };
  }
}

export async function reportUsage(fastify: FastifyInstance, payload: any) {
  try {
    const adminUrl = process.env.ADMIN_API_URL || 'http://localhost:3001';
    const response = await fetch(`${adminUrl}/internal/usage/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      fastify.log.warn({ status: response.status }, 'Admin usage report rejected');
    }
  } catch (err) {
    fastify.log.error(err, 'Failed to report usage');
  }
}

export function findProtocol(config: ResolvedProvider, protocol: string): ProtocolPath | undefined {
  return config.protocols?.find(p => p.protocol === protocol);
}

export function openAiError(message: string, type: string, code?: string) {
  return { error: { message, type, ...(code ? { code } : {}) } };
}

export function anthropicError(type: string, message: string) {
  return { type: 'error', error: { type, message } };
}
