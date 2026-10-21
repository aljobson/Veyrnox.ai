import { ApiError, type ApiClient } from './api';

type Api = Pick<ApiClient, 'request'>;
export type Cursor = { after: string; key: string | null } | null;
export interface ExportRequest { export_id: string; as_of: string; expires_at: string; resumed: boolean; sections: string[] }
export interface ExportPage { rows: Record<string, unknown>[]; next: Cursor }
export interface ExportWriter {
    create(request: ExportRequest): void | Promise<void>;
    append(text: string): void | Promise<void>;
    delete(): void | Promise<void>;
}
export type ExportProgress = { section: number; total: number; waiting: boolean };
export type ExportState = 'idle' | 'preparing' | 'ready' | 'expired' | 'unavailable' | 'restricted' | 'mfa' | 'rate_limited';
export function exportErrorState(err: unknown): ExportState {
    if (err instanceof ApiError) {
        if (err.status === 403 && err.code === 'mfa_required') return 'mfa';
        if (err.status === 403 && err.code === 'account_restricted') return 'restricted';
        if (err.status === 410) return 'expired';
        if (err.status === 429 && err.code === 'rate_limited') return 'rate_limited';
    }
    return 'unavailable';
}
export const startExport = (api: Api, signal?: AbortSignal) => api.request<ExportRequest>('/api/v1/account/export', { method: 'POST', signal });
export function fetchPage(api: Api, id: string, section: string, cursor: Cursor, thread?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ section });
    if (thread) query.set('thread', thread);
    if (cursor) {
        query.set('after', cursor.after);
        if (cursor.key !== null) query.set('key', cursor.key);
    }
    return api.request<ExportPage>(`/api/v1/account/export/${encodeURIComponent(id)}?${query}`, { signal });
}
function checkAbort(signal: AbortSignal) {
    if (signal.aborted) throw new Error('export_cancelled');
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('export_cancelled')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
}

// Only a page and the current thread are held in memory. The writer owns the private cache file.
export async function runExport(api: Api, writer: ExportWriter, onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<ExportRequest> {
    try {
        checkAbort(signal);
        let request: ExportRequest;
        try { request = await startExport(api, signal); }
        catch (err) {
            checkAbort(signal);
            if (!(err instanceof ApiError) || err.status !== 0) throw err;
            request = await startExport(api, signal);
        }
        checkAbort(signal);
        await writer.create(request);
        const expires = Date.parse(request.expires_at);
        const counts = new Map<string, number>();
        let progress: ExportProgress = { section: 0, total: request.sections.length, waiting: false };
        function check() {
            checkAbort(signal);
            if (!Number.isFinite(expires) || Date.now() >= expires) throw new ApiError(410, 'export_expired');
        }
        async function append(text: string) { check(); await writer.append(text); check(); }
        async function page(section: string, cursor: Cursor, thread?: string): Promise<ExportPage> {
            // Messages are counted per thread, so a long chat history is not cut off across many threads.
            const counter = thread ? `${section}:${thread}` : section;
            if ((counts.get(counter) ?? 0) >= 5000) throw new Error('export_page_limit');
            let retried = false;
            for (;;) {
                check();
                try {
                    const result = await fetchPage(api, request.export_id, section, cursor, thread, signal);
                    check();
                    counts.set(counter, (counts.get(counter) ?? 0) + 1);
                    onProgress({ ...progress, waiting: false });
                    return result;
                } catch (err) {
                    check();
                    if (err instanceof ApiError && err.status === 429 && err.code === 'read_throttled') {
                        onProgress({ ...progress, waiting: true });
                        const seconds = (err.retryAfterSeconds ?? Number(err.body.retry_after_seconds)) || 1;
                        await wait(Math.min(Math.max(1, seconds), 60, (expires - Date.now()) / 1000) * 1000, signal);
                    } else if (err instanceof ApiError && err.status === 0 && !retried) retried = true;
                    else throw err;
                }
            }
        }
        async function array(section: string, thread?: string) {
            let cursor: Cursor = null, first = true;
            await append('[');
            do {
                const result = await page(section, cursor, thread);
                for (const row of result.rows) {
                    await append(first ? '' : ','); first = false;
                    if (section === 'chat_threads') {
                        await append(JSON.stringify(row).slice(0, -1) + ',"messages":');
                        await array('chat_messages', String(row.id));
                        await append('}');
                    } else await append(JSON.stringify(row));
                }
                cursor = result.next;
            } while (cursor);
            await append(']');
        }
        await append(JSON.stringify({ format: 'veyrnox.ai-data-export', version: 1, as_of: request.as_of,
            record_values: 'as_of bounds which records are listed, not their field values; fields reflect the time each page is read.' }).slice(0, -1) + ',"sections":{');
        for (const [index, section] of request.sections.entries()) {
            progress = { section: index + 1, total: request.sections.length, waiting: false }; onProgress(progress);
            await append((index ? ',' : '') + JSON.stringify(section) + ':');
            if (section === 'profile') await append(JSON.stringify((await page(section, null)).rows[0] ?? {}));
            else await array(section);
        }
        await append('}}');
        return request;
    } catch (err) {
        await writer.delete();
        throw err;
    }
}
