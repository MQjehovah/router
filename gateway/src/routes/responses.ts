import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsageByFormat, calculateCost, createUsageStream } from '../providers/usage.js';
import { resolveProvider, reportUsage, findProtocol, openAiError, extractApiKey } from './helpers.js';

interface ResponsesBody {
  model: string;
  stream?: boolean;
  [key: string]: any;
}

export async function responsesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ResponsesBody }>('/v1/responses', {
    preHandler: [fastify.authenticate, fastify.rateLimit]
  }, async (req, reply) => {
    const { model, stream } = req.body;
    if (!model) {
      return reply.status(400).send(openAiError('model is required', 'invalid_request_error', 'invalid_body'));
    }

    const resolved = await resolveProvider(req, model);
    if (!resolved.ok) return reply.status(resolved.status).send(resolved.body);
    const config = resolved.config;

    const proto = findProtocol(config, 'OPENAI_RESPONSES');
    if (!proto) {
      return reply.status(400).send(openAiError('Provider does not support responses protocol', 'invalid_request_error', 'protocol_not_supported'));
    }

    const startTime = Date.now();
    const apiKey = extractApiKey(req);

    try {
      const response = await proxyRequest(config.baseUrl, proto.path, config.authType, config.apiKey, req.body, model, stream);

      if (!response.ok) {
        const error = await response.text();
        fastify.log.error({ providerId: config.providerId, error }, 'Provider error');
        return reply.status(502).send(openAiError(`Provider error: ${response.status}`, 'provider_error', 'provider_error'));
      }

      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        if (!response.body) {
          return reply.status(500).send(openAiError('Failed to read response stream', 'internal_error'));
        }

        const latencyMs = Date.now() - startTime;
        const usageStream = createUsageStream('responses', (usage) => {
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
