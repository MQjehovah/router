import { fetch, setGlobalDispatcher, Agent } from 'undici';

setGlobalDispatcher(new Agent({
  connect: { timeout: 120000 },
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 120000
}));

export async function proxyRequest(
  baseUrl: string,
  path: string,
  authType: string,
  apiKey: string,
  body: any,
  model: string,
  isStream: boolean = false,
  forwardHeaders?: Record<string, string>
): Promise<import('undici').Response> {
  let url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  if (url.includes('{model}')) {
    url = url.replace('{model}', encodeURIComponent(model));
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...forwardHeaders };

  switch (authType) {
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      if (!headers['anthropic-version']) headers['anthropic-version'] = '2023-06-01';
      break;
    case 'google':
      url += url.includes('?') ? '&' : '?';
      url += `key=${encodeURIComponent(apiKey)}`;
      break;
    default:
      headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  return response;
}
