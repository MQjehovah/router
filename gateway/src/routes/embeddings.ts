import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsage, calculateCost, formatFor } from '../providers/usage.js';
import { resolveProvider, reportUsage, extractApiKey, sendUpstreamError } from './helpers.js';

interface EmbeddingsBody {
  model: string;
  input: string | string[];
  [key: string]: any;
}

// 估算输入 tokens：仅在上游未返回 usage 对象时兜底使用。
// len/4 是对 UTF-16 字符数的粗略近似——对英文/空白较合适，但 CJK 等字符往往偏少，仅作兜底、不精确。
export function estimateTokensIn(input: string | string[]): number {
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

      const data = await response.json() as any;
      const latencyMs = Date.now() - startTime;
      const apiKey = extractApiKey(req);

      // 按 provider 实际协议格式解析用量，与 chat 路由保持一致（future-safe 对齐）。
      let usage = extractUsage(formatFor(config.providerType), data);
      if (!data.usage) {
        // 上游未返回 usage 对象（如无 usage 字段）时，按输入长度估算兜底。
        // 若已返回 usage（即便 prompt_tokens=0），则直接采信，不估算。
        usage = { tokensIn: estimateTokensIn(input), tokensOut: 0, cachedTokens: 0 };
      }

      const pricing = config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 };
      // embeddings 不产生输出 token，tokensOut 恒为 0，成本只计输入（含缓存）。
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
