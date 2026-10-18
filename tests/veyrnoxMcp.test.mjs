import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { estimatedCredits } = await import('../lib/veyrnoxMcp.js');

test('MCP estimates image/audio once and video in five-second units', () => {
  assert.equal(estimatedCredits({ modality: 'text-to-image', credits: 4 }, 10), 4);
  assert.equal(estimatedCredits({ modality: 'text-to-audio', credits: 3 }), 3);
  assert.equal(estimatedCredits({ modality: 'text-to-video', credits: 6, durations: [5, 10] }, 5), 6);
  assert.equal(estimatedCredits({ modality: 'image-to-video', credits: 6, durations: [5, 10] }, 10), 12);
  assert.equal(estimatedCredits({ modality: 'text-to-video', credits: 6, durations: [5, 10] }, 15), null);
});

test('the public MCP surface is deliberately small, and its only spending tool is the capped image generator', () => {
  const source = readFileSync(new URL('../lib/veyrnoxMcp.js', import.meta.url), 'utf8');
  const names = [...source.matchAll(/registerTool\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, ['list_models', 'estimate_generation', 'generate_image', 'get_generation', 'list_generations', 'get_balance']);
  assert.doesNotMatch(source, /generate_media|generate_video|generate_audio|source_asset_ids|consent:\s*z\./, 'no video, audio, source-file or consent inputs on the connector');
  assert.equal([...source.matchAll(/routeJson\(createGeneration/g)].length, 1, 'one call site reaches the generation route, and only through startMcpGeneration');
  const tool = source.slice(source.indexOf("registerTool('generate_image'"), source.indexOf("registerTool('get_generation'"));
  assert.match(tool, /startMcpGeneration/);
  assert.match(tool, /readOnlyHint: false/);
  assert.match(tool, /This tool spends credits/);
});

test('protected-resource metadata points the MCP client at Supabase OAuth', async () => {
  const saved = { SUPABASE_URL: process.env.SUPABASE_URL, PUBLIC_HOST: process.env.PUBLIC_HOST };
  Object.assign(process.env, { SUPABASE_URL: 'https://project.supabase.co', PUBLIC_HOST: 'https://veyrnox.test' });
  try {
    const path = '../app/.well-known/oauth-protected-resource/api/v1/mcp/route.js?test=' + Date.now();
    const { GET } = await import(path);
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await response.json(), {
      resource: 'https://veyrnox.test/api/v1/mcp',
      authorization_servers: ['https://project.supabase.co/auth/v1'],
      scopes_supported: ['openid', 'email', 'profile'],
      resource_name: 'Veyrnox.ai MCP',
      resource_documentation: 'https://veyrnox.test/mcp',
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('an unauthenticated MCP request advertises its OAuth resource metadata', async () => {
  const saved = { SUPABASE_URL: process.env.SUPABASE_URL, PUBLIC_HOST: process.env.PUBLIC_HOST };
  Object.assign(process.env, { SUPABASE_URL: 'https://project.supabase.co', PUBLIC_HOST: 'https://veyrnox.test' });
  const realError = console.error;
  console.error = () => {};
  try {
    const { middleware } = await import('../middleware.js');
    const response = await middleware(new Request('https://veyrnox.test/api/v1/mcp'));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer resource_metadata="https://veyrnox.test/.well-known/oauth-protected-resource/api/v1/mcp"');
  } finally {
    console.error = realError;
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('the MCP handler refuses a browser identity without an OAuth client', async () => {
  const { POST } = await import('../app/api/v1/mcp/route.js');
  const response = await POST(new Request('https://veyrnox.test/api/v1/mcp', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': '33333333-3333-4333-8333-333333333333' },
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'oauth_client_required');
  assert.match(response.headers.get('www-authenticate'), /error="insufficient_scope"/);
});

test('the HTTP endpoint completes an MCP initialize handshake', async () => {
  const { POST } = await import('../app/api/v1/mcp/route.js');
  const request = new Request('https://veyrnox.test/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-veyrnox-auth-id': '33333333-3333-4333-8333-333333333333',
      'x-veyrnox-auth-client-id': '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'veyrnox-test', version: '1.0.0' },
      },
    }),
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /"name":"veyrnox-ai"/);
  assert.match(body, /"protocolVersion":"2025-11-25"/);
});

async function callTool(name, args, fetchImpl, t) {
  Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test' });
  t.mock.method(globalThis, 'fetch', fetchImpl);
  const { POST } = await import('../app/api/v1/mcp/route.js');
  const response = await POST(new Request('https://veyrnox.test/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'x-veyrnox-auth-id': '33333333-3333-4333-8333-333333333333', 'x-veyrnox-auth-client-id': '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const text = await response.text();
  return JSON.parse(text.includes('data:') ? text.split('data:').pop().trim() : text).result;
}
const IMAGE_ROW = { id: 'flux-2-pro-1k-kie', provider: 'kie', provider_endpoint: 'market:flux-2/pro-text-to-image', modality: 'text-to-image', credits_5s: 2, active: true, gated_flag: false };

test('through the real MCP handler, a wrong price confirmation is refused before any job is read or any debit is made', async (t) => {
  const paths = [];
  const result = await callTool('generate_image', {
    model_id: 'flux-2-pro-1k-kie', prompt: 'a plain grey mannequin head', confirmed_credits: 1, idempotency_key: 'mcp-wiring-0001',
  }, async (url) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path === '/rest/v1/model_catalog') return Response.json([IMAGE_ROW]);
    assert.fail(`the connector reached ${path} after a wrong confirmation`);
  }, t);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, 'credit_confirmation_mismatch');
  assert.equal(result.structuredContent.expected_credits, 2);
  assert.ok(paths.every((p) => p === '/rest/v1/model_catalog'), JSON.stringify(paths));
});

test('through the real MCP handler, a video model is refused as image-only and nothing else is called', async (t) => {
  const result = await callTool('generate_image', {
    model_id: 'kling-3.0-i2v', prompt: 'x', confirmed_credits: 34, idempotency_key: 'mcp-wiring-0002',
  }, async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/rest/v1/model_catalog') return Response.json([{ ...IMAGE_ROW, id: 'kling-3.0-i2v', modality: 'image-to-video', provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', credits_5s: 34 }]);
    assert.fail(`the connector reached ${path} for a video model`);
  }, t);
  assert.deepEqual([result.isError, result.structuredContent.error], [true, 'mcp_image_only']);
});
