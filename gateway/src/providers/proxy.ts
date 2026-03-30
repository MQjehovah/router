import { fetch, setGlobalDispatcher, Agent } from 'undici';

setGlobalDispatcher(new Agent({ connect: { timeout: 120000 } }));

export async function proxyRequest(
  baseUrl: string,
  path: string,
  apiKey: string,
  body: any,
  isStream: boolean = false
): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    dispatcher: new Agent({
      connect: { timeout: 120000 }
    })
  });

  return response;
}