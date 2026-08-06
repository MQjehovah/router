export interface Pricing {
  inputPrice: number;
  outputPrice: number;
  cachePrice: number;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
}

// tokensIn = 非缓存输入（不含缓存命中）；cachedTokens = 缓存命中输入（独立）
// totalTokens = tokensIn + tokensOut + cachedTokens，对所有协议成立。

export type UsageFormat = 'chat' | 'responses' | 'anthropic' | 'google';

export function formatFor(providerType: string): UsageFormat {
  switch (providerType) {
    case 'ANTHROPIC': return 'anthropic';
    case 'GOOGLE': return 'google';
    default: return 'chat';
  }
}

function readUsageByFormat(format: UsageFormat, raw: any): Usage {
  if (format === 'responses') {
    const u = raw?.usage || {};
    const cached = u.input_tokens_details?.cached_tokens || 0;
    return {
      tokensIn: Math.max(0, (u.input_tokens || 0) - cached),
      tokensOut: u.output_tokens || 0,
      cachedTokens: cached
    };
  }
  if (format === 'anthropic') {
    const u = raw?.usage || {};
    return {
      tokensIn: u.input_tokens || 0,
      tokensOut: u.output_tokens || 0,
      cachedTokens: u.cache_read_input_tokens || 0
    };
  }
  if (format === 'google') {
    const u = raw?.usageMetadata || {};
    const cached = u.cachedContentTokenCount || 0;
    return {
      tokensIn: Math.max(0, (u.promptTokenCount || 0) - cached),
      tokensOut: u.candidatesTokenCount || 0,
      cachedTokens: cached
    };
  }
  const u = raw?.usage || {};
  const cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    tokensIn: Math.max(0, (u.prompt_tokens || 0) - cached),
    tokensOut: u.completion_tokens || 0,
    cachedTokens: cached
  };
}

export function extractUsage(providerType: string, body: any): Usage {
  return readUsageByFormat(formatFor(providerType), body);
}

export function extractUsageByFormat(format: UsageFormat, body: any): Usage {
  return readUsageByFormat(format, body);
}

export function calculateCost(usage: Usage, pricing: Pricing): number {
  const per = (v: number) => v / 1_000_000;
  return (
    usage.tokensIn * per(pricing.inputPrice || 0)
    + usage.cachedTokens * per(pricing.cachePrice || 0)
    + usage.tokensOut * per(pricing.outputPrice || 0)
  );
}

export function createUsageTracker(
  format: UsageFormat,
  onDone: (usage: Usage) => Promise<void> | void
): { stream: TransformStream<Uint8Array, Uint8Array>; getUsage: () => Usage } {
  const tokens = { in: 0, out: 0, cached: 0 };
  const decoder = new TextDecoder();
  let buffer = '';

  const feed = (json: any) => {
    if (format === 'responses') {
      if (json?.type === 'response.completed') {
        const u = readUsageByFormat('responses', json.response);
        tokens.in = u.tokensIn;
        tokens.out = u.tokensOut;
        tokens.cached = u.cachedTokens;
      }
      return;
    }
    if (format === 'anthropic') {
      if (json?.type === 'message_start') {
        const u = json?.message?.usage || {};
        tokens.in = u.input_tokens || 0;
        tokens.cached = u.cache_read_input_tokens || 0;
      } else if (json?.type === 'message_delta') {
        tokens.out = json?.usage?.output_tokens || 0;
      }
      return;
    }
    if (format === 'google') {
      if (json?.usageMetadata) {
        const u = readUsageByFormat(format, json);
        tokens.in = u.tokensIn;
        tokens.out = u.tokensOut;
        tokens.cached = u.cachedTokens;
      }
      return;
    }
    if (json?.usage) {
      const u = readUsageByFormat(format, json);
      tokens.in = u.tokensIn;
      tokens.out = u.tokensOut;
      tokens.cached = u.cachedTokens;
    }
  };

  const parseLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try { feed(JSON.parse(payload)); } catch { /* ignore */ }
  };

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        parseLine(line);
      }
      controller.enqueue(chunk);
    },
    async flush() {
      if (buffer.trim()) parseLine(buffer);
      await onDone({ tokensIn: tokens.in, tokensOut: tokens.out, cachedTokens: tokens.cached });
    }
  });

  const getUsage = () => ({ tokensIn: tokens.in, tokensOut: tokens.out, cachedTokens: tokens.cached });
  return { stream, getUsage };
}

export function createUsageStream(
  format: UsageFormat,
  onDone: (usage: Usage) => Promise<void> | void
): TransformStream<Uint8Array, Uint8Array> {
  return createUsageTracker(format, onDone).stream;
}
