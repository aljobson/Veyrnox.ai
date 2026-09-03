import { proxyToMuapi } from '@/lib/muapiProxy';

function upstreamPath(pathSegments) {
    return `/api/v1/creative-agent/${pathSegments.join('/')}`;
}

async function handle(request, params, method) {
    const slug = await params;
    return proxyToMuapi(request, upstreamPath(slug.path || []), method);
}

export const GET = (req, { params }) => handle(req, params, 'GET');
export const POST = (req, { params }) => handle(req, params, 'POST');
export const PATCH = (req, { params }) => handle(req, params, 'PATCH');
export const DELETE = (req, { params }) => handle(req, params, 'DELETE');
