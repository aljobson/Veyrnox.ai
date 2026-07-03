/**
 * Veyrnox Gateway — Cloudflare Worker Entrypoint
 * 
 * Stack: ADR-001 (§22.6)
 * - Cloudflare Workers (gateway + webhooks)
 * - Hyperdrive (Neon Postgres connection)
 * - Queues (job pipeline)
 * - R2 (media storage, EU jurisdiction)
 * - Workflows (state machine)
 */

import { GatewayWorker } from './worker/gateway';

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // Route: POST /v1/generations
    if (url.pathname === '/v1/generations' && request.method === 'POST') {
      return handleGenerationRequest(request, env);
    }

    // Route: GET /v1/generations/:jobId
    if (url.pathname.startsWith('/v1/generations/') && request.method === 'GET') {
      const jobId = url.pathname.split('/').pop();
      return handleGetJob(jobId!, env);
    }

    // 404
    return new Response('Not Found', { status: 404 });
  },
};

async function handleGenerationRequest(request: Request, env: any): Promise<Response> {
  try {
    const body = await request.json() as any;

    // Extract Idempotency-Key header (mandatory for retry safety)
    const idempotency_key = request.headers.get('Idempotency-Key');
    if (!idempotency_key) {
      return new Response(
        JSON.stringify({ error: 'Idempotency-Key header required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract user from auth (Clerk or custom JWT)
    // TODO: Verify auth token and extract user_id
    const userId = 'test-user'; // Placeholder

    // Create gateway and handle request
    const gateway = new GatewayWorker(env.LEDGER); // Hyperdrive binding
    const response = await gateway.generateImage(body, userId);

    return new Response(JSON.stringify(response), {
      status: response.error ? 402 : 200, // 402 = Payment Required (insufficient credits)
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function handleGetJob(jobId: string, env: any): Promise<Response> {
  try {
    const gateway = new GatewayWorker(env.LEDGER);
    const job = await gateway.getJob(jobId);

    return new Response(JSON.stringify(job), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
