import { ApiError, type ApiClient } from '../src/lib/api';
import {
    expiryLabel,
    fetchFileLink,
    fetchMasters,
    fetchRenders,
    fileErrorMessage,
    lengthLabel,
    parseFileLink,
    parseFiles,
    resolutionLabel,
    sizeLabel,
} from '../src/lib/libraryFiles';

const row = { id: 'f1', label: 'Spring teaser', size_bytes: 12_582_912, width: 1080, height: 1920, seconds: 12.5, frame_rate: 30, created_at: '2026-10-18T10:00:00Z', expires_at: '2026-11-17T10:00:00Z' };
const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string) => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

describe('parseFiles', () => {
    test('reads masters and renders by their own list key, and whether the feature is on', () => {
        const m = parseFiles({ enabled: true, masters: [row] }, 'masters');
        expect(m.enabled).toBe(true);
        expect(m.files[0]).toMatchObject({ id: 'f1', label: 'Spring teaser', sizeBytes: 12_582_912, width: 1080, height: 1920, seconds: 12.5, frameRate: 30 });
        expect(parseFiles({ enabled: true, renders: [row] }, 'renders').files).toHaveLength(1);
    });
    test('off, missing or unusable means no files and the screen says it is not available', () => {
        expect(parseFiles({ enabled: false, masters: [row] }, 'masters')).toEqual({ enabled: false, files: [] });
        expect(parseFiles(null, 'masters')).toEqual({ enabled: false, files: [] });
        expect(parseFiles({ enabled: true, masters: 'x' }, 'masters')).toEqual({ enabled: true, files: [] });
    });
    test('drops rows without an id, and keeps a row whose numbers are missing', () => {
        const r = parseFiles({ enabled: true, masters: [{ ...row, id: '' }, { id: 'f2', label: 'Bare' }] }, 'masters');
        expect(r.files).toHaveLength(1);
        expect(r.files[0]).toMatchObject({ id: 'f2', label: 'Bare', sizeBytes: null, width: null, seconds: null, expiresAt: null });
    });
    test('a missing label gets a plain name instead of blank', () => {
        expect(parseFiles({ enabled: true, masters: [{ ...row, label: ' ' }] }, 'masters').files[0].label).toBe('Untitled video');
    });
});

describe('labels', () => {
    test('size in MB, or KB when small, and nothing when unknown', () => {
        expect(sizeLabel(12_582_912)).toBe('12 MB');
        expect(sizeLabel(512_000)).toBe('500 KB');
        expect(sizeLabel(null)).toBeNull();
    });
    test('length as seconds or minutes and seconds', () => {
        expect(lengthLabel(12.5)).toBe('13 s');
        expect(lengthLabel(75)).toBe('1 min 15 s');
        expect(lengthLabel(null)).toBeNull();
    });
    test('resolution', () => {
        expect(resolutionLabel(1080, 1920)).toBe('1080 × 1920');
        expect(resolutionLabel(null, 1920)).toBeNull();
    });
    test('expiry in days, hours, today and already gone', () => {
        const now = new Date('2026-10-18T10:00:00Z');
        expect(expiryLabel('2026-10-28T10:00:00Z', now)).toBe('Expires in 10 days');
        expect(expiryLabel('2026-10-19T10:00:00Z', now)).toBe('Expires in 1 day');
        expect(expiryLabel('2026-10-18T15:00:00Z', now)).toBe('Expires in 5 hours');
        expect(expiryLabel('2026-10-18T10:20:00Z', now)).toBe('Expires within the hour');
        expect(expiryLabel('2026-10-17T10:00:00Z', now)).toBe('Expired');
        expect(expiryLabel(null, now)).toBeNull();
    });
});

describe('requests', () => {
    test('fetchMasters and fetchRenders read the two lists', async () => {
        const a = apiWith({ enabled: true, masters: [row] });
        expect((await fetchMasters(a.api)).files).toHaveLength(1);
        expect(a.request).toHaveBeenCalledWith('/api/v1/library/masters');
        const b = apiWith({ enabled: true, renders: [row] });
        expect((await fetchRenders(b.api)).files).toHaveLength(1);
        expect(b.request).toHaveBeenCalledWith('/api/v1/library/editor-renders');
    });
    test('fetchFileLink reads the short-lived link for one file, encoded', async () => {
        const a = apiWith({ url: 'https://r2.example/x.mp4?sig=1', mime_type: 'video/mp4', size_bytes: 5, expires_in: 900 });
        const link = await fetchFileLink(a.api, 'masters', 'a/b');
        expect(link).toEqual({ url: 'https://r2.example/x.mp4?sig=1', mimeType: 'video/mp4' });
        expect(a.request).toHaveBeenCalledWith('/api/v1/library/masters/a%2Fb/asset');
        await fetchFileLink(a.api, 'renders', 'r1');
        expect(a.request).toHaveBeenLastCalledWith('/api/v1/library/editor-renders/r1/asset');
    });
});

describe('parseFileLink', () => {
    test('only an https link is used, and the type must be video', () => {
        expect(parseFileLink({ url: 'https://x/y.mp4', mime_type: 'video/mp4' })).toEqual({ url: 'https://x/y.mp4', mimeType: 'video/mp4' });
        expect(parseFileLink({ url: 'http://x/y.mp4', mime_type: 'video/mp4' })).toBeNull();
        expect(parseFileLink({ url: 'javascript:alert(1)', mime_type: 'video/mp4' })).toBeNull();
        expect(parseFileLink({ url: 'https://x/y', mime_type: 'text/html' })).toBeNull();
        expect(parseFileLink(null)).toBeNull();
    });
});

describe('fileErrorMessage', () => {
    const e = (status: number, code: string) => fileErrorMessage(new ApiError(status, code));
    test('not found, expired, rate limited, busy and offline', () => {
        expect(e(404, 'not_found')).toMatch(/no longer available/);
        expect(e(404, 'NOT_FOUND')).toMatch(/no longer available/);
        expect(e(429, 'rate_limited')).toMatch(/Try again in a moment/);
        expect(e(503, 'library_unavailable')).toMatch(/busy/);
        expect(e(503, 'asset_unavailable')).toMatch(/busy/);
        expect(e(0, 'network')).toMatch(/connection/);
        expect(fileErrorMessage(new Error('x'))).toMatch(/Something went wrong/);
    });
});
