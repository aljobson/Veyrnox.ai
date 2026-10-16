import { developerOpenApi } from '../../../../lib/developerOpenApi.js';

export function GET() {
    return Response.json(developerOpenApi, {
        headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' },
    });
}
