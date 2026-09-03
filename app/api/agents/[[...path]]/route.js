import { proxyToMuapi } from '@/lib/muapiProxy';

// e.g. GET /api/agents?is_template=true  → https://api.muapi.ai/agents?is_template=true
// e.g. GET /api/agents/by-slug/foo       → https://api.muapi.ai/agents/by-slug/foo
function upstreamPath(pathSegments) {
    const path = pathSegments.join('/');
    return path ? `/agents/${path}` : '/agents';
}

// forwardBinary: some agent endpoints return non-JSON payloads (e.g. exports).
const OPTS = { forwardBinary: true };

export async function GET(request, { params }) {
    const { path = [] } = await params;
    return proxyToMuapi(request, upstreamPath(path), 'GET', OPTS);
}

export async function POST(request, { params }) {
    const { path = [] } = await params;
    return proxyToMuapi(request, upstreamPath(path), 'POST', OPTS);
}

export async function PUT(request, { params }) {
    const { path = [] } = await params;
    return proxyToMuapi(request, upstreamPath(path), 'PUT', OPTS);
}

export async function DELETE(request, { params }) {
    const { path = [] } = await params;
    return proxyToMuapi(request, upstreamPath(path), 'DELETE', OPTS);
}
