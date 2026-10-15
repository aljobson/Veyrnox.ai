import { createMcpHandler } from '@modelcontextprotocol/server';
import { createVeyrnoxMcpServer } from '../../../../lib/veyrnoxMcp.js';

export const dynamic = 'force-dynamic';

const handler = createMcpHandler(
    ({ requestInfo }) => createVeyrnoxMcpServer(requestInfo),
    {
        legacy: 'stateless',
        maxRequestBodySize: 64 * 1024,
        onerror(error) {
            console.error('[mcp] protocol error:', error?.message || error);
        },
    },
);

function serve(request) {
    if (!request.headers.get('x-veyrnox-auth-id')) {
        return Response.json({ error: 'not_authenticated' }, { status: 401 });
    }
    return handler.fetch(request);
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
