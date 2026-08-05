import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsage, calculateCost, formatFor } from '../providers/usage.js';
import { resolveProvider, reportUsage, extractApiKey, createReportedUsageStream, sendUpstreamError } from './helpers.js';

interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
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
        return sendUpstreamError(fastify, reply, response, 'openai');
      }

      const apiKey = extractApiKey(req);

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
        // 中断/出错的流由 reply close 触发补记部分 token 的 0 费记录，便于对账。
        const usageStream = createReportedUsageStream(fastify, {
          apiKey,
          providerId: config.providerId,
          model,
          pricing: config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 },
          format: formatFor(config.providerType),
          reply,
          latencyMs
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
    const apiKey = extractApiKey(req);

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
