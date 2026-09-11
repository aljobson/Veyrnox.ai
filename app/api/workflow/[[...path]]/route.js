import { proxyToMuapi, safeUpstreamPath } from '@/lib/muapiProxy';

// forwardBinary: some workflow endpoints stream non-JSON bodies.
const OPTS = { forwardBinary: true };

function upstreamPath(pathSegments) {
    return safeUpstreamPath('/workflow', pathSegments);
}

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
