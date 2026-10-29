import { ApiError } from '../src/lib/api';
import { skipVibeStatus } from '../src/lib/creatorProfile';
test.each([
    [{ status: 'skipped' }, 'skipped'], [{ status: 'completed' }, 'kept'],
    [{}, 'failed'], [{ status: 'other' }, 'failed'], [null, 'failed'],
    [new ApiError(404, 'not_found'), 'unavailable'], [new ApiError(502, 'down'), 'failed'],
])('strict skip response %p is %s', async (body, kind) => {
    const request = jest.fn(async () => { if (body instanceof Error) throw body; return body as any; });
    expect(await skipVibeStatus({ request })).toEqual({ kind });
    expect(request).toHaveBeenCalledWith('/api/v1/creator-profile/skip', { method: 'POST' });
});
