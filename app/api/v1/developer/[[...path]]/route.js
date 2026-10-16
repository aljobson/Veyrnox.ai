import { developerApi } from '../../../../../lib/developerApi.js';

export const dynamic = 'force-dynamic';

async function serve(request, { params }) {
    const { path = [] } = await params;
    return developerApi(request, path);
}

export const GET = serve;
export const POST = serve;
export const OPTIONS = serve;
