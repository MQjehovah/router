import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';

interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

const PROVIDER_CONFIG: Record<string, { baseUrl: string; path: string; envKey: string; providerId: number }> = {
  gpt: { baseUrl: 'https://api.openai.com/v1', path: '/chat/completions', envKey: 'OPENAI_API_KEY', providerId: 1 },
  claude: { baseUrl: 'https://api.anthropic.com/v1', path: '/messages', envKey: 'ANTHROPIC_API_KEY', providerId: 2 },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', path: '/models', envKey: 'GOOGLE_API_KEY', providerId: 3 },
  hf: { baseUrl: 'https://api-inference.huggingface.co', path: '/pipelines', envKey: 'HUGGINGFACE_API_KEY', providerId: 4 }
};

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ChatBody }>('/v1/chat/completions', {
    preHandler: [fastify.authenticate, fastify.rateLimit]
  }, async (req, reply) => {
    const { model, messages, stream, ...options } = req.body;
    
    const providerMatch = model.match(/^(gpt|claude|gemini|hf)-/);
    if (!providerMatch) {
      return reply.status(400).send({
        error: {
          message: `Unknown model prefix: ${model}`,
          type: 'invalid_request_error',
          code: 'invalid_model'
        }
      });
    }

    const providerName = providerMatch[1];
    const config = PROVIDER_CONFIG[providerName];
    
    if (!config) {
      return reply.status(400).send({
        error: {
          message: `Provider not supported: ${providerName}`,
          type: 'invalid_request_error',
          code: 'unsupported_provider'
        }
      });
    }

    const apiKey = process.env[config.envKey] || '';
    if (!apiKey) {
      return reply.status(500).send({
        error: {
          message: `Provider not configured: ${config.envKey}`,
          type: 'internal_error',
          code: 'provider_not_configured'
        }
      });
    }

    const requestBody: any = {
      model,
      messages,
      stream,
      ...options
    };

    const startTime = Date.now();
    
    try {
      const response = await proxyRequest(
        config.baseUrl,
        config.path,
        apiKey,
        requestBody,
        stream
      );

      if (!response.ok) {
        const error = await response.text();
        fastify.log.error({ provider: providerName, error }, 'Provider error');
        return reply.status(502).send({
          error: {
            message: `Provider error: ${response.status}`,
            type: 'provider_error',
            code: 'provider_error'
          }
        });
      }

      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        const reader = response.body?.getReader();
        
        if (!reader) {
          return reply.status(500).send({
            error: { message: 'Failed to read response stream', type: 'internal_error' }
          });
        }

        const streamData = new ReadableStream({
          async start(controller) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          }
        });

        const latencyMs = Date.now() - startTime;
        
        setTimeout(async () => {
          try {
            await fetch(`${process.env.ADMIN_API_URL}/internal/usage/report`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Internal-Secret': process.env.INTERNAL_SECRET || ''
              },
              body: JSON.stringify({
                apiKey: req.headers.authorization?.substring(7),
                providerId: config.providerId,
                model,
                tokensIn: 0,
                tokensOut: 0,
                cost: 0,
                latencyMs
              })
            });
          } catch (err) {
            fastify.log.error(err, 'Failed to report usage');
          }
        }, 100);

        return reply.send(streamData);
      }

      const data = await response.json();
      
      const latencyMs = Date.now() - startTime;
      
      setTimeout(async () => {
        try {
          await fetch(`${process.env.ADMIN_API_URL}/internal/usage/report`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-Secret': process.env.INTERNAL_SECRET || ''
            },
            body: JSON.stringify({
              apiKey: req.headers.authorization?.substring(7),
              providerId: config.providerId,
              model,
              tokensIn: data.usage?.prompt_tokens || 0,
              tokensOut: data.usage?.completion_tokens || 0,
              cost: ((data.usage?.prompt_tokens || 0) * 0.00001 + (data.usage?.completion_tokens || 0) * 0.00003),
              latencyMs
            })
          });
        } catch (err) {
          fastify.log.error(err, 'Failed to report usage');
        }
      }, 100);

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

  fastify.get('/v1/models', async (req, reply) => {
    return {
      data: [
        { id: 'gpt-4', object: 'model', created: 1687882411, owned_by: 'openai' },
        { id: 'gpt-3.5-turbo', object: 'model', created: 1677649963, owned_by: 'openai' },
        { id: 'claude-3-opus', object: 'model', created: 1709596800, owned_by: 'anthropic' },
        { id: 'claude-3-sonnet', object: 'model', created: 1709596800, owned_by: 'anthropic' },
        { id: 'gemini-pro', object: 'model', created: 1704067200, owned_by: 'google' },
        { id: 'gemini-pro-vision', object: 'model', created: 1704067200, owned_by: 'google' }
      ],
      object: 'list'
    };
  });
}