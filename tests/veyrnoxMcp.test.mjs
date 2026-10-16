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

test('the public MCP surface is deliberately small and cannot spend credits', () => {
  const source = readFileSync(new URL('../lib/veyrnoxMcp.js', import.meta.url), 'utf8');
  const names = [...source.matchAll(/registerTool\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, ['list_models', 'estimate_generation', 'get_generation', 'list_generations', 'get_balance']);
  assert.doesNotMatch(source, /createGeneration|generate_media|confirmed_credits/);
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
