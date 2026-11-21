import { ApiError, type ApiClient } from '../api';
import { isExportQuote, isExportStart, isExportFile, type ExportFormat } from './validateExport';
const path = (id: string) => `/api/v1/music/songs/${encodeURIComponent(id)}`;
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function createExportQuote(api: ApiClient, songId: string, versionId: string, format: ExportFormat) {
    const value = await api.request<unknown>(`${path(songId)}/export-quotes`, json({ version_id: versionId, format }), { timeoutMs: 30_000 });
    if (!isExportQuote(value, format)) throw new ApiError(201, 'bad_response');
    return value.quote;
}
export async function startExport(api: ApiClient, songId: string, quoteId: string, key: string) {
    const value = await api.request<unknown>(`${path(songId)}/exports`, json({ quote_id: quoteId, idempotency_key: key }), { timeoutMs: 30_000 });
    if (!isExportStart(value)) throw new ApiError(201, 'bad_response');
    return value;
}
export async function getExport(api: ApiClient, id: string, format: ExportFormat) {
    const value = await api.request<unknown>(`/api/v1/music/exports/${encodeURIComponent(id)}`, undefined, { timeoutMs: 30_000 });
    if (!isExportFile(value, format, id)) throw new ApiError(200, 'bad_response');
    return value.export;
}
