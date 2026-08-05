import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsage, calculateCost, createUsageStream, formatFor } from '../providers/usage.js';

interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

interface ResolvedProvider {
  model: string;
  providerId: number;
  baseUrl: string;
  path: string;
  authType: string;
  apiKey: string;
  providerType: string;
  pricing: { inputPrice: number; outputPrice: number; cachePrice: number };
}

async function resolveProvider(req: FastifyRequest, model: string): Promise<{ ok: true; config: ResolvedProvider } | { ok: false; status: number; body: any }> {
  const adminUrl = process.env.ADMIN_API_URL || 'http://localhost:3001';
  const secret = process.env.INTERNAL_SECRET || '';
  const apiKey = req.headers.authorization?.substring(7) || '';

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

async function reportUsage(fastify: FastifyInstance, payload: any) {
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

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ChatBody }>('/v1/chat/completions', {
    preHandler: [fastify.authenticate, fastify.rateLimit]
  }, async (req, reply) => {
    const { model, messages, stream, ...options } = req.body;

    if (!model || !messages?.length) {
      return reply.status(400).send({
        error: { message: 'model and messages are required', type: 'invalid_request_error', code: 'invalid_body' }
      });
    }

    const resolved = await resolveProvider(req, model);
    if (!resolved.ok) {
      return reply.status(resolved.status).send(resolved.body);
    }
    const config = resolved.config;

    const requestBody: any = {
      model,
      messages,
      stream,
      ...options
    };

    const startTime = Date.now();

    try {
      const injectStreamOptions = stream && (config.providerType === 'OPENAI' || config.providerType === 'DEEPSEEK');
      const upstreamBody = injectStreamOptions
        ? { ...requestBody, stream_options: { include_usage: true } }
        : requestBody;

      let response = await proxyRequest(
        config.baseUrl,
        config.path,
        config.authType,
        config.apiKey,
        upstreamBody,
        model,
        stream
      );

      if (stream && injectStreamOptions && !response.ok) {
        response = await proxyRequest(
          config.baseUrl,
          config.path,
          config.authType,
          config.apiKey,
          requestBody,
          model,
          stream
        );
      }

      if (!response.ok) {
        const error = await response.text();
        fastify.log.error({ providerId: config.providerId, error }, 'Provider error');
        return reply.status(502).send({
          error: {
            message: `Provider error: ${response.status}`,
            type: 'provider_error',
            code: 'provider_error'
          }
        });
      }

      const apiKey = req.headers.authorization?.substring(7);

      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        if (!response.body) {
          return reply.status(500).send({
            error: { message: 'Failed to read response stream', type: 'internal_error' }
          });
        }

        const latencyMs = Date.now() - startTime;
        // 流结束时上报用量；fire-and-forget，避免 admin 上报阻塞响应结束。
        // 中断/出错的流不会触发 flush，故不产生记录（避免误导性的 0 token 记录）。
        const usageStream = createUsageStream(formatFor(config.providerType), (usage) => {
          const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
          reportUsage(fastify, {
            apiKey,
            providerId: config.providerId,
            model,
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            cachedTokens: usage.cachedTokens,
            cost,
            latencyMs
          });
        });

        return reply.send(response.body.pipeThrough(usageStream as any));
      }

      const data = await response.json();
      
      const latencyMs = Date.now() - startTime;
      
      const usage = extractUsage(config.providerType, data);
      const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
      reportUsage(fastify, {
        apiKey,
        providerId: config.providerId,
        model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cachedTokens: usage.cachedTokens,
        cost,
        latencyMs
      });

      return data;
    } catch (err) {
      fastify.log.error(err, 'Proxy request failed');
      return reply.status(500).send({
        error: {
          message: 'Failed to proxy request',
          type: 'internal_error',
          code: 'proxy_failed'
        }
      });
    }
  });

  fastify.get('/v1/models', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const adminUrl = process.env.ADMIN_API_URL || 'http://localhost:3001';
    const secret = process.env.INTERNAL_SECRET || '';
    const apiKey = req.headers.authorization?.substring(7);

    try {
      const response = await fetch(`${adminUrl}/internal/keys/models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret
        },
        body: JSON.stringify({ apiKey })
      });

      if (!response.ok) {
        return reply.status(401).send({ error: { message: 'Invalid API key', type: 'authentication_error' } });
      }

      const { models } = await response.json();
      return {
        object: 'list',
        data: models.map((id: string, i: number) => ({
          id,
          object: 'model',
          created: 1687882411 + i,
          owned_by: id.split('-')[0]
        }))
      };
    } catch (err) {
      fastify.log.error(err, 'Failed to list models');
      return reply.status(500).send({ error: { message: 'Failed to list models', type: 'internal_error' } });
    }
  });
}
