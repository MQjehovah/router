export const PROTOCOLS = ['OPENAI_CHAT', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES'] as const;
export type Protocol = typeof PROTOCOLS[number];

export const DEFAULT_PROTOCOL_PATHS: Record<Protocol, string> = {
  OPENAI_CHAT: '/chat/completions',
  OPENAI_RESPONSES: '/responses',
  ANTHROPIC_MESSAGES: '/v1/messages'
};

export function effectiveProtocolPath(protocol: string, path: string | null | undefined): string {
  return path || DEFAULT_PROTOCOL_PATHS[protocol as Protocol] || '';
}
