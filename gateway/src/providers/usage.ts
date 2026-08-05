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

function readUsage(providerType: string, raw: any): Usage {
  if (providerType === 'ANTHROPIC') {
    const u = raw?.usage || {};
    return {
      tokensIn: u.input_tokens || 0,
      tokensOut: u.output_tokens || 0,
      cachedTokens: u.cache_read_input_tokens || 0
    };
  }
  if (providerType === 'GOOGLE') {
    const u = raw?.usageMetadata || {};
    return {
      tokensIn: u.promptTokenCount || 0,
      tokensOut: u.candidatesTokenCount || 0,
      cachedTokens: u.cachedContentTokenCount || 0
    };
  }
  const u = raw?.usage || {};
  return {
    tokensIn: u.prompt_tokens || 0,
    tokensOut: u.completion_tokens || 0,
    cachedTokens: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0
  };
}

export function extractUsage(providerType: string, body: any): Usage {
  return readUsage(providerType, body);
}

export function calculateCost(usage: Usage, pricing: Pricing): number {
  const per = (v: number) => v / 1_000_000;
  const missInput = Math.max(0, usage.tokensIn - usage.cachedTokens);
  return (
    missInput * per(pricing.inputPrice || 0)
    + usage.cachedTokens * per(pricing.cachePrice || 0)
    + usage.tokensOut * per(pricing.outputPrice || 0)
  );
}

export function createUsageStream(
  providerType: string,
  onDone: (usage: Usage) => Promise<void> | void
): TransformStream<Uint8Array, Uint8Array> {
  const tokens = { in: 0, out: 0, cached: 0 };
  const decoder = new TextDecoder();
  let buffer = '';

  const feed = (json: any) => {
    if (providerType === 'ANTHROPIC') {
      if (json?.type === 'message_start') {
        const u = json?.message?.usage || {};
        tokens.in = u.input_tokens || 0;
        tokens.cached = u.cache_read_input_tokens || 0;
      } else if (json?.type === 'message_delta') {
        tokens.out = json?.usage?.output_tokens || 0;
      }
      return;
    }
    if (providerType === 'GOOGLE') {
      if (json?.usageMetadata) {
        const u = readUsage(providerType, json);
        tokens.in = u.tokensIn;
        tokens.out = u.tokensOut;
        tokens.cached = u.cachedTokens;
      }
      return;
    }
    if (json?.usage) {
      const u = readUsage(providerType, json);
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

  return new TransformStream<Uint8Array, Uint8Array>({
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
}
