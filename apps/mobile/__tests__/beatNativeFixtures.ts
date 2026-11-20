import { createApiClient } from '../src/lib/api';
import { createBeat } from '../src/lib/beatNative/doc';
import type { BeatFiles } from '../src/lib/beatNative/persist';
export const USER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const PROJECT = '33333333-3333-4333-8333-333333333333';
export const VERSION = '44444444-4444-4444-8444-444444444444';
export const fixedDoc = () => createBeat({ id: PROJECT, title: 'Test beat', now: 1000 });
export const project = (id: string, revision = 1) => ({ id: PROJECT, beat_id: id, title: 'Test beat', doc_version: 4, revision, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z' });
export const version = (revision = 1) => ({ id: VERSION, revision, title: 'Earlier beat', reason: 'checkpoint', saved_at: '2026-11-20T10:00:00Z' });
export function memoryFiles() {
    const data = new Map<string, string>();
    const files: BeatFiles = {
        read: jest.fn(async (name: string) => data.get(name) ?? null),
        write: jest.fn(async (name: string, text: string) => { data.set(name, text); }),
        remove: jest.fn(async (name: string) => { data.delete(name); }),
        list: jest.fn(async () => [...data.keys()]),
    };
    return { ...files, data };
}
export function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
export const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export const response = (body: unknown, status = 200, retry?: number): Response => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (key: string) => key === 'retry-after' && retry ? String(retry) : null },
    json: async () => body,
} as Response);
export const failure = (code: string, status: number, retry?: number) => response({ error: { code, message: 'Server detail', requestId: 'request-1' } }, status, retry);
export function fakeApi(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
    const fetcher = jest.fn((url: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(url), init ?? {})));
    global.fetch = fetcher as typeof fetch;
    let user = USER;
    const tokenFor = () => `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: user }))}.test`;
    const api = createApiClient({ baseUrl: 'https://example.test', getAccessToken: async () => tokenFor(), onSessionLost: jest.fn() });
    return { api, fetcher, token: tokenFor(), setUser: (next: string) => { user = next; } };
}
