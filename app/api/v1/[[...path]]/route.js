import { proxyToMuapi } from '@/lib/muapiProxy';

// Internal proxy for /api/v1/* -> https://api.muapi.ai/api/v1/*.
// Replaces the previous middleware-based NextResponse.rewrite() approach,
// whose semantics differ across Vercel Edge vs OpenNext-Cloudflare (external
// rewrites can 404 or leak internals). Sibling routes with custom logic
// (creative-agent, get_upload_url, upload-binary) live at more specific
// segments and take precedence over this catch-all.

// forwardBinary: some upstream endpoints return non-JSON bodies.
const OPTS = { forwardBinary: true };

function upstreamPath(pathSegments) {
    return `/api/v1/${pathSegments.join('/')}`;
}

async function handle(request, ctx, method) {
    const { path = [] } = await ctx.params;
    return proxyToMuapi(request, upstreamPath(path), method, OPTS);
}

export const GET = (req, ctx) => handle(req, ctx, 'GET');
export const POST = (req, ctx) => handle(req, ctx, 'POST');
export const PUT = (req, ctx) => handle(req, ctx, 'PUT');
export const PATCH = (req, ctx) => handle(req, ctx, 'PATCH');
export const DELETE = (req, ctx) => handle(req, ctx, 'DELETE');
