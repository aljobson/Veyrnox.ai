import { ApiError, type ApiClient } from '../src/lib/api';
import { CONFIRM_MESSAGE, CONFIRM_TITLE, deleteCreation, deleteMessage, isAlreadyGone } from '../src/lib/deleteCreation';

const JOB = '8f1c2d3e-0000-4000-8000-123456789abc';

const apiWith = (result: unknown) => {
    const request = jest.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

describe('deleteCreation', () => {
    test('sends DELETE for exactly that job, with no body', async () => {
        const { api, request } = apiWith({ deleted: true, replayed: false });
        await deleteCreation(api, JOB);
        const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
        expect(path).toBe(`/api/v1/jobs/${JOB}`);
        expect(init.method).toBe('DELETE');
        expect(init.body).toBeUndefined();
    });

    test('a repeat (replayed) delete is a success, not an error', async () => {
        await expect(deleteCreation(apiWith({ deleted: true, replayed: true }).api, JOB)).resolves.toBeUndefined();
    });

    test('an answer that does not say deleted is an error, never a silent success', async () => {
        await expect(deleteCreation(apiWith({}).api, JOB)).rejects.toMatchObject({ code: 'internal' });
        await expect(deleteCreation(apiWith({ deleted: false }).api, JOB)).rejects.toMatchObject({ code: 'internal' });
    });

    test('percent-encodes the id so it cannot change the path', async () => {
        const { api, request } = apiWith({ deleted: true });
        await deleteCreation(api, '../x?y=1');
        expect((request.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/jobs/..%2Fx%3Fy%3D1');
    });

    test('passes a server refusal through unchanged', async () => {
        await expect(deleteCreation(apiWith(new ApiError(409, 'job_on_hold')).api, JOB)).rejects.toMatchObject({ code: 'job_on_hold', status: 409 });
    });
});

describe('isAlreadyGone', () => {
    test('a 404 not_found means it is already deleted or not yours: nothing left to delete', () => {
        expect(isAlreadyGone(new ApiError(404, 'not_found'))).toBe(true);
        expect(isAlreadyGone(new ApiError(409, 'job_on_hold'))).toBe(false);
        expect(isAlreadyGone(new Error('x'))).toBe(false);
    });
});

describe('confirm text', () => {
    test('says it is permanent, that the file and prompt are erased, that credits are not refunded, and that it stays in history', () => {
        expect(CONFIRM_TITLE).toBe('Delete this creation?');
        expect(CONFIRM_MESSAGE).toMatch(/permanently erases the file and the prompt/);
        expect(CONFIRM_MESSAGE).toMatch(/credits are not refunded/i);
        expect(CONFIRM_MESSAGE).toMatch(/counted in your history/);
        expect(CONFIRM_MESSAGE).toMatch(/cannot be undone/);
    });
});

describe('deleteMessage', () => {
    test('words each refusal plainly and says nothing was deleted', () => {
        expect(deleteMessage(new ApiError(409, 'job_in_progress'))).toMatch(/still being made/i);
        expect(deleteMessage(new ApiError(409, 'job_on_hold'))).toMatch(/held for review/i);
        expect(deleteMessage(new ApiError(403, 'account_frozen'))).toMatch(/account is on hold/i);
        expect(deleteMessage(new ApiError(409, 'used_by_post'))).toMatch(/Publish post/);
        expect(deleteMessage(new ApiError(409, 'used_by_cinema'))).toMatch(/Cinema/);
        expect(deleteMessage(new ApiError(409, 'used_by_library'))).toMatch(/Film Library/);
        expect(deleteMessage(new ApiError(429, 'rate_limited'))).toMatch(/too many/i);
        expect(deleteMessage(new ApiError(502, 'internal'))).toMatch(/nothing was changed/i);
        expect(deleteMessage(new ApiError(503, 'not_configured'))).toMatch(/nothing was changed/i);
        expect(deleteMessage(new ApiError(0, 'network'))).toMatch(/connection/i);
        expect(deleteMessage(new Error('x'))).toMatch(/nothing was changed/i);
    });
});
