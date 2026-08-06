import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Response } from 'undici';
import { createUsageTracker, calculateCost, Usage, Pricing, UsageFormat } from '../providers/usage.js';
import { createTimedCache } from '../cache.js';

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

const resolveCache = createTimedCache<ResolvedProvider>(() => {
  const raw = Number(process.env.RESOLVE_CACHE_TTL);
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 60_000;
});

export async function resolveProvider(req: FastifyRequest, model: string): Promise<{ ok: true; config: ResolvedProvider } | { ok: false; status: number; body: any }> {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return resolveRemote(req, apiKey, model);
  }

  const cacheKey = `${apiKey}|${model}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) {
    return { ok: true, config: cached };
  }

  const result = await resolveRemote(req, apiKey, model);
  if (result.ok) {
    resolveCache.set(cacheKey, result.config);
  }
  return result;
}

async function resolveRemote(req: FastifyRequest, apiKey: string, model: string): Promise<{ ok: true; config: ResolvedProvider } | { ok: false; status: number; body: any }> {
  const adminUrl = process.env.ADMIN_API_URL || 'http://localhost:3001';
  const secret = process.env.INTERNAL_SECRET || '';

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

export interface ReportedUsageStreamOptions {
  apiKey: string;
  providerId: number;
  model: string;
  pricing: Pricing;
  format: UsageFormat;
  reply: FastifyReply;
  latencyMs: number;
}

export function createReportedUsageStream(
  fastify: FastifyInstance,
  opts: ReportedUsageStreamOptions
): TransformStream<Uint8Array, Uint8Array> {
  let reported = false;
  const report = (usage: Usage, cost: number) => {
    if (reported) return;
    reported = true;
    reportUsage(fastify, {
      apiKey: opts.apiKey,
      providerId: opts.providerId,
      model: opts.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      cachedTokens: usage.cachedTokens,
      cost,
      latencyMs: opts.latencyMs
    });
  };

  const { stream, getUsage } = createUsageTracker(opts.format, usage => report(usage, calculateCost(usage, opts.pricing)));

  opts.reply.raw.on('close', () => {
    const partial = getUsage();
    if (!reported && (partial.tokensIn > 0 || partial.tokensOut > 0 || partial.cachedTokens > 0)) {
      report(partial, 0);
    }
  });

  return stream;
}

export async function sendUpstreamError(
  fastify: FastifyInstance,
  reply: FastifyReply,
  response: Response,
  envelope: 'openai' | 'anthropic' = 'openai'
): Promise<FastifyReply> {
  const status = response.status;
  const raw = await response.text();
  fastify.log.error({ upstreamStatus: status, body: raw.slice(0, 500) }, 'Provider error');

  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object') {
    if (parsed.error && typeof parsed.error === 'object' && (parsed.error.message || parsed.error.type || parsed.error.code)) {
      return reply.status(status).send(parsed);
    }
    if (parsed.type === 'error' && parsed.error) {
      return reply.status(status).send(parsed);
    }
    const msg = parsed.error?.message || parsed.message || JSON.stringify(parsed).slice(0, 500);
    return reply.status(status).send(
      envelope === 'anthropic' ? anthropicError('api_error', msg) : openAiError(msg, 'provider_error', 'provider_error')
    );
  }

  const msg = raw.slice(0, 500) || `Provider error: ${status}`;
  return reply.status(status).send(
    envelope === 'anthropic' ? anthropicError('api_error', msg) : openAiError(msg, 'provider_error', 'provider_error')
  );
}
