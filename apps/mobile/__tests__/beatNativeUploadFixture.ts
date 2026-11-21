/** Deterministic XHR event source; tests control native progress, completion and abort. */
export function uploadFixture() {
    const requests: ReturnType<typeof request>[] = [];
    let autoComplete = true, status = 200;
    const request = () => ({
        status, withCredentials: true,
        upload: { onprogress: null as ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null },
        onload: null as (() => void) | null, onerror: null as (() => void) | null,
        onabort: null as (() => void) | null, ontimeout: null as (() => void) | null,
        open: jest.fn(), setRequestHeader: jest.fn(),
        abort: jest.fn(function (this: { onabort: (() => void) | null }) { this.onabort?.(); }),
        send: jest.fn(function (this: { onload: (() => void) | null }) { if (autoComplete) this.onload?.(); }),
    });
    const makeRequest = jest.fn(() => { const xhr = request(); requests.push(xhr); return xhr as unknown as XMLHttpRequest; });
    return { requests, makeRequest, hold: () => { autoComplete = false; }, status: (value: number) => { status = value; },
        progress: (loaded: number, total = 100) => requests.at(-1)!.upload.onprogress?.({ loaded, total, lengthComputable: true }),
        complete: () => requests.at(-1)!.onload?.() };
}
