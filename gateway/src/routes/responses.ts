import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsageByFormat, calculateCost } from '../providers/usage.js';
import { resolveProvider, reportUsage, findProtocol, openAiError, extractApiKey, createReportedUsageStream, sendUpstreamError } from './helpers.js';

interface ResponsesBody {
  model: string;
  stream?: boolean;
  [key: string]: any;
}

const FORWARD_HEADERS = ['anthropic-beta', 'anthropic-version', 'openai-organization', 'openai-project', 'openai-beta'];

export async function responsesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ResponsesBody }>('/v1/responses', {
    preHandler: [fastify.authenticate, fastify.rateLimit]
  }, async (req, reply) => {
    const { model, stream } = req.body;
    if (!model) {
      return reply.status(400).send(openAiError('model is required', 'invalid_request_error', 'invalid_body'));
    }

    const resolved = await resolveProvider(req, model);
    if (!resolved.ok) {
      const msg = (resolved.body as any)?.error || 'Failed to resolve model';
      return reply.status(resolved.status).send(openAiError(msg, 'invalid_request_error', 'resolve_failed'));
    }
    const config = resolved.config;

    const proto = findProtocol(config, 'OPENAI_RESPONSES');
    if (!proto) {
      return reply.status(400).send(openAiError('Provider does not support responses protocol', 'invalid_request_error', 'protocol_not_supported'));
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
        return sendUpstreamError(fastify, reply, response, 'openai');
      }

      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        if (!response.body) {
          return reply.status(500).send(openAiError('Failed to read response stream', 'internal_error'));
        }

        const latencyMs = Date.now() - startTime;
        const usageStream = createReportedUsageStream(fastify, {
          apiKey,
          providerId: config.providerId,
          model,
          pricing: config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 },
          format: 'responses',
          reply,
          latencyMs
        });

        return reply.send(response.body.pipeThrough(usageStream as any));
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;
      const usage = extractUsageByFormat('responses', data);
      const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
      reportUsage(fastify, {
        apiKey, providerId: config.providerId, model,
        tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cachedTokens: usage.cachedTokens,
        cost, latencyMs
      });
      return data;
    } catch (err) {
      fastify.log.error(err, 'Proxy request failed');
      return reply.status(500).send(openAiError('Failed to proxy request', 'internal_error', 'proxy_failed'));
    }
  });
}
