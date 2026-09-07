import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsage, calculateCost } from '../providers/usage.js';
import { resolveProvider, reportUsage, extractApiKey, sendUpstreamError } from './helpers.js';

interface EmbeddingsBody {
  model: string;
  input: string | string[];
  [key: string]: any;
}

function estimateTokensIn(input: string | string[]): number {
  const inputs = Array.isArray(input) ? input : [input];
  const totalChars = inputs.reduce((sum: number, item: string) => sum + item.length, 0);
  return Math.ceil(totalChars / 4);
}

export async function embeddingsRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: EmbeddingsBody }>('/v1/embeddings', {
    preHandler: [fastify.authenticate, fastify.rateLimit, fastify.quotaCheck]
  }, async (req, reply) => {
    const { model, input, ...options } = req.body;

    const inputList = Array.isArray(input) ? input : [input];
    const validModel = model != null && typeof model === 'string' && model.trim().length > 0;
    const validInput = inputList.every(item => typeof item === 'string')
      && inputList.some(item => (item as string).trim().length > 0);

    if (!validModel || input == null || !validInput) {
      return reply.status(400).send({
        error: { message: 'model and non-empty input are required', type: 'invalid_request_error', code: 'invalid_body' }
      });
    }

    const resolved = await resolveProvider(req, model);
    if (!resolved.ok) {
      return reply.status(resolved.status).send(resolved.body);
    }
    const config = resolved.config;

    const requestBody: any = { model, input, ...options };

    const startTime = Date.now();

    try {
      const response = await proxyRequest(
        config.baseUrl,
        config.path || '/v1/embeddings',
        config.authType,
        config.apiKey,
        requestBody,
        model,
        false
      );

      if (!response.ok) {
        return sendUpstreamError(fastify, reply, response, 'openai');
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;
      const apiKey = extractApiKey(req);

      let usage = extractUsage('chat', data);
      if (usage.tokensIn <= 0) {
        usage = { tokensIn: estimateTokensIn(input), tokensOut: 0, cachedTokens: 0 };
      }

      const pricing = config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 };
      const cost = calculateCost({ tokensIn: usage.tokensIn, tokensOut: 0, cachedTokens: 0 }, pricing);

      reportUsage(fastify, {
        apiKey,
        providerId: config.providerId,
        model,
        tokensIn: usage.tokensIn,
        tokensOut: 0,
        cachedTokens: 0,
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
}
