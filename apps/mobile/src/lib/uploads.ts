import { ApiError, type ApiClient } from './api';

interface UploadGrant {
    readonly key: string;
    readonly upload_url: string;
    readonly content_type: string;
    readonly headers?: Record<string, string>;
}

// Sends one local file to a presigned URL. Reports progress from 0 to 1.
export type PutFile = (url: string, headers: Record<string, string>, uri: string, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<void>;

// React Native fetch cannot report upload progress, so the file goes through XMLHttpRequest.
export const putFile: PutFile = async (url, headers, uri, onProgress, signal) => {
    const blob = await (await fetch(uri)).blob();
    await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = (e) => e.lengthComputable && e.total > 0 && onProgress(e.loaded / e.total);
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`put_${xhr.status}`)));
        xhr.onerror = () => reject(new Error('put_network'));
        xhr.onabort = () => reject(new Error('put_aborted'));
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
        if (signal.aborted) return xhr.abort();
        xhr.send(blob);
    });
};

// Mints a presigned URL, sends the file, and returns the storage key a generation refers to.
// Bytes go straight to storage; the key is what the server later inspects and checks for ownership.
export async function uploadSource(
    api: ApiClient,
    file: { readonly uri: string; readonly size?: number },
    contentType: string,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
    put: PutFile = putFile,
): Promise<string> {
    const grant = await api.request<UploadGrant>('/api/v1/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: contentType, size_bytes: file.size }),
    });
    try {
        await put(grant.upload_url, { 'Content-Type': grant.content_type, ...(grant.headers ?? {}) }, file.uri, onProgress, signal);
    } catch {
        throw new ApiError(0, signal.aborted ? 'upload_cancelled' : 'upload_failed');
    }
    return grant.key;
}

export function uploadMessage(err: unknown): string {
    if (!(err instanceof ApiError)) return 'Could not upload that file. Try again.';
    switch (err.code) {
        case 'insufficient_credits':
            return 'You need credits to upload a file. Buy some first.';
        case 'too_many_pending_uploads':
        case 'upload_budget_exceeded':
        case 'rate_limited':
            return 'Too many uploads right now. Wait a minute and try again.';
        case 'upload_too_large':
            return 'That file is too large.';
        case 'upload_type_not_allowed':
            return 'That file type is not supported.';
        case 'network':
            return 'No connection. Check it and try again.';
        case 'upload_cancelled':
            return 'Upload cancelled.';
        default:
            return 'Could not upload that file. Try again.';
    }
}
