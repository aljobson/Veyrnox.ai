import { ApiError } from '../api';
import type { MixdownTask } from './mixdownSave';

export const MIXDOWN_UPLOAD_STALL_MS = 60_000;
export type UploadRequestFactory = () => XMLHttpRequest;
/** RN's native request can wait indefinitely; bound inactivity, not total upload time. */
export function uploadMixdown(url: string, headers: Record<string, string>, bytes: ArrayBuffer, task: MixdownTask,
    progress: (percent: number) => void, makeRequest: UploadRequestFactory): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = makeRequest();
        let settled = false, loaded = 0, timer: ReturnType<typeof setTimeout>;
        const current = () => !!task.user && task.current() && !task.signal.aborted;
        const finish = (error?: ApiError, abort = false) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            task.signal.removeEventListener('abort', sessionAbort);
            xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = xhr.upload.onprogress = null;
            if (abort) { try { xhr.abort(); } catch { /* Already torn down by the native transport. */ } }
            if (error) reject(error); else resolve();
        };
        const sessionAbort = () => finish(new ApiError(401, 'account_changed'), true);
        const networkError = () => current() ? finish(new ApiError(0, 'network_error'), true) : sessionAbort();
        const resetDeadline = () => { clearTimeout(timer); timer = setTimeout(networkError, MIXDOWN_UPLOAD_STALL_MS); };
        if (!current()) { sessionAbort(); return; }
        task.signal.addEventListener('abort', sessionAbort, { once: true });
        xhr.onload = () => {
            if (!current()) { sessionAbort(); return; }
            finish((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412 ? undefined : new ApiError(xhr.status, 'upload_failed'));
        };
        xhr.onerror = xhr.ontimeout = xhr.onabort = networkError;
        xhr.upload.onprogress = event => {
            if (!current()) { sessionAbort(); return; }
            if (event.loaded > loaded) { loaded = event.loaded; resetDeadline(); }
            if (event.lengthComputable && event.total > 0) progress(Math.min(100, Math.round(event.loaded / event.total * 100)));
        };
        try {
            xhr.open('PUT', url, true);
            xhr.withCredentials = false;
            for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
            if (!current()) { sessionAbort(); return; }
            resetDeadline(); xhr.send(bytes);
        } catch { networkError(); }
    });
}
