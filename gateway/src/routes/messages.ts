import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsageByFormat, calculateCost, createUsageStream } from '../providers/usage.js';
import { resolveProvider, reportUsage, findProtocol, anthropicError, extractApiKey } from './helpers.js';

interface MessagesBody {
  model: string;
  stream?: boolean;
  [key: string]: any;
}

const FORWARD_HEADERS = ['anthropic-beta', 'anthropic-version', 'openai-organization', 'openai-project', 'openai-beta'];

export async function messagesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: MessagesBody }>('/v1/messages', {
    preHandler: [fastify.authenticate, fastify.rateLimit]
  }, async (req, reply) => {
    const { model, stream } = req.body;
    if (!model) {
      return reply.status(400).send(anthropicError('invalid_request_error', 'model is required'));
    }

    const resolved = await resolveProvider(req, model);
    if (!resolved.ok) {
      const msg = (resolved.body as any)?.error || 'Failed to resolve model';
      const type = resolved.status === 404 ? 'not_found_error' : 'api_error';
      return reply.status(resolved.status).send(anthropicError(type, msg));
    }
    const config = resolved.config;

    const proto = findProtocol(config, 'ANTHROPIC_MESSAGES');
    if (!proto) {
      return reply.status(400).send(anthropicError('invalid_request_error', 'Provider does not support anthropic messages protocol'));
    }

    const startTime = Date.now();
    const apiKey = extractApiKey(req);

    const forwarded: Record<string, string> = {};
    for (const h of FORWARD_HEADERS) {
      const v = req.headers[h];
      if (typeof v === 'string') forwarded[h] = v;
    }

    try {
      const response = await proxyRequest(config.baseUrl, proto.path, config.authType, config.apiKey, req.body, model, stream, forwarded);

      if (!response.ok) {
        const error = await response.text();
        fastify.log.error({ providerId: config.providerId, error }, 'Provider error');
        return reply.status(502).send(anthropicError('api_error', `Provider error: ${response.status}`));
      }

      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        if (!response.body) {
          return reply.status(500).send(anthropicError('api_error', 'Failed to read response stream'));
        }

        const latencyMs = Date.now() - startTime;
        const usageStream = createUsageStream('anthropic', (usage) => {
          const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
          reportUsage(fastify, {
            apiKey, providerId: config.providerId, model,
            tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cachedTokens: usage.cachedTokens,
            cost, latencyMs
          });
        });

        return reply.send(response.body.pipeThrough(usageStream as any));
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;
      const usage = extractUsageByFormat('anthropic', data);
      const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
      reportUsage(fastify, {
        apiKey, providerId: config.providerId, model,
        tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cachedTokens: usage.cachedTokens,
        cost, latencyMs
      });
      return data;
    } catch (err) {
      fastify.log.error(err, 'Proxy request failed');
      return reply.status(500).send(anthropicError('api_error', 'Failed to proxy request'));
    }
  });
}
