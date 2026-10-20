import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ApiError, type ApiClient } from './api';

// ADR-0166: saved reports. The list comes from GET /reports; PDF and slide files come from
// GET /reports/:id/export and are written to the cache, then handed to the system share sheet. Creating and editing a
// report template stays on the web for now.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportFormat = 'pdf' | 'pptx';
export const FORMATS: readonly ReportFormat[] = ['pdf', 'pptx'];
const MIME: Record<ReportFormat, string> = { pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
// A report file stays well under this; a larger answer is refused rather than held in memory.
const MAX_BYTES = 25 * 1024 * 1024;

export interface Report {
    readonly id: string;
    readonly name: string;
    readonly rangeDays: number;
    readonly comparePrevious: boolean;
    readonly cadence: string;
    readonly nextDeliveryAt: string | null;
    readonly lastDeliveryAt: string | null;
    readonly lastDeliveryStatus: string | null;
}

export function parseReports(body: unknown): { reports: Report[]; exportsEnabled: boolean } {
    const b = isObject(body) ? body : {};
    const reports: Report[] = [];
    for (const raw of Array.isArray(b.templates) ? b.templates : []) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const name = str(raw.name);
        if (!id || !UUID_RE.test(id) || !name) continue;
        reports.push({
            id, name,
            rangeDays: typeof raw.range_days === 'number' ? raw.range_days : 30,
            comparePrevious: raw.compare_previous === true,
            cadence: str(raw.delivery_cadence) ?? 'manual',
            nextDeliveryAt: str(raw.next_delivery_at),
            lastDeliveryAt: str(raw.last_delivery_at),
            lastDeliveryStatus: str(raw.last_delivery_status),
        });
    }
    return { reports, exportsEnabled: b.reportExportsEnabled === true };
}

export const fetchReports = async (api: ApiClient) => parseReports(await api.request('/api/v1/social/reports'));

// The file name is built from the report's id, never from server text, so a hostile name cannot pick a path.
export const fileNameFor = (id: string, format: ReportFormat): string => `veyrnox-report-${id.slice(0, 8).toLowerCase()}.${format}`;

export async function exportReport(api: ApiClient, id: string, format: ReportFormat): Promise<string> {
    const res = await api.stream(`/api/v1/social/reports/${encodeURIComponent(id)}/export?format=${format}`);
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new ApiError(res.status, typeof body.error === 'string' ? body.error : 'unknown');
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new ApiError(502, 'export_invalid');
    const file = new File(Paths.cache, fileNameFor(id, format));
    if (file.exists) file.delete();
    file.create();
    await file.write(bytes);
    return file.uri;
}

export async function shareReport(api: ApiClient, id: string, format: ReportFormat): Promise<void> {
    const uri = await exportReport(api, id, format);
    await Sharing.shareAsync(uri, { mimeType: MIME[format] });
}

export function reportsErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'reports.err.share';
    if (err.status === 0) return 'reports.err.network';
    if (err.status === 402) return 'reports.err.plan';
    if (err.status === 404) return 'reports.err.notOpen';
    if (err.status === 409) return 'reports.err.noData';
    if (err.status === 429) return 'reports.err.rate';
    if (err.code === 'export_invalid') return 'reports.err.invalid';
    return 'reports.err.later';
}
