import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ApiError, type ApiClient } from './api';

// ADR-0166: saved reports. The list comes from GET /reports; PDF and slide files come from
// GET /reports/:id/export and are written to the cache, then handed to the system share sheet.
// ADR-0272 adds template editing over the same brand-scoped route.

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
    readonly accountId: string | null;
    readonly includeContent: boolean;
    readonly reportTitle: string;
    readonly accentColor: string;
    readonly deliveryHourUtc: number | null;
    readonly deliveryWeekday: number | null;
    readonly deliveryDay: number | null;
    readonly deliveryRecipients: string[];
    readonly deliveryReplyTo: string;
    readonly deliveryMessage: string;
    readonly deliveryFormat: ReportFormat;
    readonly lastDeliveryError: string | null;
    readonly nextDeliveryAt: string | null;
    readonly lastDeliveryAt: string | null;
    readonly lastDeliveryStatus: string | null;
}

export interface ReportFlags { scheduledReportsEnabled: boolean; reportDeliveryEnabled: boolean }
export interface ReportsState extends ReportFlags { reports: Report[]; exportsEnabled: boolean; brandRole: string }
const boundedInteger = (v: unknown, min: number, max: number): number | null => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
export function parseReports(body: unknown): ReportsState {
    const b = isObject(body) ? body : {};
    const reports: Report[] = [];
    for (const raw of Array.isArray(b.templates) ? b.templates : []) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const name = str(raw.name);
        if (!id || !UUID_RE.test(id) || !name) continue;
        reports.push({
            id, name,
            accountId: typeof raw.account_id === 'string' && UUID_RE.test(raw.account_id) ? raw.account_id : null,
            includeContent: raw.include_content !== false,
            reportTitle: typeof raw.report_title === 'string' ? raw.report_title : '',
            accentColor: typeof raw.accent_color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent_color) ? raw.accent_color.toLowerCase() : '#38bdf8',
            deliveryHourUtc: boundedInteger(raw.delivery_hour_utc, 0, 23),
            deliveryWeekday: boundedInteger(raw.delivery_weekday, 1, 7),
            deliveryDay: boundedInteger(raw.delivery_day, 1, 28),
            deliveryRecipients: Array.isArray(raw.delivery_recipients) ? raw.delivery_recipients.filter((v): v is string => typeof v === 'string').slice(0, 10) : [],
            deliveryReplyTo: typeof raw.delivery_reply_to === 'string' ? raw.delivery_reply_to : '',
            deliveryMessage: typeof raw.delivery_message === 'string' ? raw.delivery_message : '',
            deliveryFormat: raw.delivery_format === 'pptx' ? 'pptx' : 'pdf',
            lastDeliveryError: str(raw.last_delivery_error),
            rangeDays: typeof raw.range_days === 'number' ? raw.range_days : 30,
            comparePrevious: raw.compare_previous === true,
            cadence: str(raw.delivery_cadence) ?? 'manual',
            nextDeliveryAt: str(raw.next_delivery_at),
            lastDeliveryAt: str(raw.last_delivery_at),
            lastDeliveryStatus: str(raw.last_delivery_status),
        });
    }
    return { reports, exportsEnabled: b.reportExportsEnabled === true, brandRole: str(b.brandRole) ?? 'viewer',
        scheduledReportsEnabled: b.scheduledReportsEnabled === true, reportDeliveryEnabled: b.reportDeliveryEnabled === true };
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

export function reportsErrorKey(err: unknown, operation: 'export' | 'save' | 'delete' = 'export'): string {
    if (operation !== 'export') {
        if (!(err instanceof ApiError)) return 'reports.err.later';
        if (err.status === 400) return 'publishReporting.err.fields';
        if (err.status === 403) return 'publishReporting.err.role';
        if (err.status === 404) return ['scheduled_reports_not_open', 'reports_not_open'].includes(err.code) ? 'reports.err.notOpen' : 'publishReporting.err.unavailable';
        if (err.status === 409) return err.code === 'report_name_taken' ? 'publishReporting.err.nameTaken' : err.code === 'report_limit' ? 'publishReporting.err.limit' : 'reports.err.later';
    }
    if (!(err instanceof ApiError)) return 'reports.err.share';
    if (err.status === 0) return 'reports.err.network';
    if (err.status === 402) return 'reports.err.plan';
    if (err.status === 404) return 'reports.err.notOpen';
    if (err.status === 409) return 'reports.err.noData';
    if (err.status === 429) return 'reports.err.rate';
    if (err.code === 'export_invalid') return 'reports.err.invalid';
    return 'reports.err.later';
}


export const canEditReports = (role: string) => ['owner', 'manager', 'editor', 'analyst'].includes(role);
export interface ReportForm {
    id: string | null; name: string; accountId: string | null; rangeDays: number;
    comparePrevious: boolean; includeContent: boolean; reportTitle: string; accentColor: string;
    deliveryCadence: string; deliveryHourUtc: number | null; deliveryWeekday: number | null; deliveryDay: number | null;
    deliveryRecipients: string | string[]; deliveryReplyTo: string; deliveryMessage: string; deliveryFormat: ReportFormat;
}
export function emptyReportForm(): ReportForm {
    return { id: null, name: '', accountId: null, rangeDays: 30, comparePrevious: false, includeContent: true,
        reportTitle: '', accentColor: '#38bdf8', deliveryCadence: 'manual', deliveryHourUtc: 9, deliveryWeekday: 1, deliveryDay: 1,
        deliveryRecipients: '', deliveryReplyTo: '', deliveryMessage: '', deliveryFormat: 'pdf' };
}
export function formFromReport(r: Report): ReportForm {
    return { id: r.id, name: r.name, accountId: r.accountId, rangeDays: r.rangeDays, comparePrevious: r.comparePrevious,
        includeContent: r.includeContent, reportTitle: r.reportTitle, accentColor: r.accentColor, deliveryCadence: r.cadence,
        deliveryHourUtc: r.deliveryHourUtc ?? 9, deliveryWeekday: r.deliveryWeekday ?? 1, deliveryDay: r.deliveryDay ?? 1,
        deliveryRecipients: r.deliveryRecipients, deliveryReplyTo: r.deliveryReplyTo, deliveryMessage: r.deliveryMessage, deliveryFormat: r.deliveryFormat };
}
const EMAIL = /^[^\s<>@]{1,64}@[^\s<>@]{1,185}\.[^\s<>@]{1,63}$/;
export function buildReportBody(form: ReportForm) {
    const error = { errorKey: 'publishReporting.err.fields', body: undefined } as const;
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    const reportTitle = typeof form.reportTitle === 'string' ? form.reportTitle.trim() : '';
    const accentColor = typeof form.accentColor === 'string' ? form.accentColor.toLowerCase() : '';
    const accountId = form.accountId || null;
    const cadence = form.deliveryCadence;
    const rawRecipients = typeof form.deliveryRecipients === 'string' ? form.deliveryRecipients.split(/[\s,;]+/).filter(Boolean) : form.deliveryRecipients;
    if (!Array.isArray(rawRecipients) || rawRecipients.some(v => typeof v !== 'string')) return error;
    const deliveryRecipients = [...new Set(rawRecipients.map(v => v.trim().toLowerCase()))];
    const deliveryReplyTo = typeof form.deliveryReplyTo === 'string' ? form.deliveryReplyTo.trim().toLowerCase() : '';
    const deliveryMessage = typeof form.deliveryMessage === 'string' ? form.deliveryMessage.trim() : '';
    if ((form.id !== null && !UUID_RE.test(form.id)) || !name || name.length > 80 || (accountId !== null && !UUID_RE.test(accountId))
        || ![7, 30, 90, 365].includes(form.rangeDays) || typeof form.comparePrevious !== 'boolean' || typeof form.includeContent !== 'boolean'
        || reportTitle.length > 100 || !['manual', 'weekly', 'monthly'].includes(cadence)
        || (cadence !== 'manual' && boundedInteger(form.deliveryHourUtc, 0, 23) === null)
        || (cadence === 'weekly' && boundedInteger(form.deliveryWeekday, 1, 7) === null)
        || (cadence === 'monthly' && boundedInteger(form.deliveryDay, 1, 28) === null)
        || deliveryRecipients.length > 10 || deliveryRecipients.some(v => v.length > 254 || !EMAIL.test(v))
        || (cadence !== 'manual' && !deliveryRecipients.length) || (deliveryReplyTo && (deliveryReplyTo.length > 254 || !EMAIL.test(deliveryReplyTo)))
        || deliveryMessage.length > 1000 || !FORMATS.includes(form.deliveryFormat)) return error;
    if (!/^#[0-9a-f]{6}$/i.test(accentColor)) return { errorKey: 'publishReporting.err.accent' } as const;
    return { body: { id: form.id, name, accountId, rangeDays: form.rangeDays, comparePrevious: form.comparePrevious,
        includeContent: form.includeContent, reportTitle, accentColor, deliveryCadence: cadence,
        deliveryHourUtc: cadence === 'manual' ? null : form.deliveryHourUtc,
        deliveryWeekday: cadence === 'weekly' ? form.deliveryWeekday : null, deliveryDay: cadence === 'monthly' ? form.deliveryDay : null,
        deliveryRecipients, deliveryReplyTo, deliveryMessage, deliveryFormat: form.deliveryFormat } };
}
export type ReportBody = NonNullable<ReturnType<typeof buildReportBody>['body']>;
export const saveReport = (api: ApiClient, body: ReportBody) => api.request('/api/v1/social/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const deleteReport = (api: ApiClient, id: string) => api.request(`/api/v1/social/reports?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

// Manual templates remain editable even when scheduling is closed. Never offer a schedule the route will refuse.
export function scheduleMode(template: Report | null, flags: ReportFlags) {
    const scheduled = !!template && template.cadence !== 'manual';
    const readOnly = scheduled && (!flags.scheduledReportsEnabled || (!flags.reportDeliveryEnabled && !template.deliveryRecipients.length));
    return { readOnly,
        cadenceEditable: !readOnly && flags.scheduledReportsEnabled && (flags.reportDeliveryEnabled || scheduled),
        deliveryEditable: !readOnly && flags.reportDeliveryEnabled,
        noteKey: readOnly ? (!flags.scheduledReportsEnabled ? 'publishReporting.schedule.closed' : 'publishReporting.schedule.legacy') : null,
        confirmationKey: flags.reportDeliveryEnabled ? 'publishReporting.schedule.emailConfirm' : 'publishReporting.schedule.pendingConfirm' } as const;
}
export const reportParams = (r: Report) => ({ days: String(r.rangeDays), compare: r.comparePrevious ? '1' : '0', account: r.accountId ?? '',
    content: r.includeContent ? '1' : '0', reportTitle: r.reportTitle, accent: r.accentColor });
