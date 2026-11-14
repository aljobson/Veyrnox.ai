import { formatLocale, plural, t } from './i18n';
import type { ApiClient } from './api';

// ADR-0130: the two read-only file lists in the Library, film masters and editor renders, with the short-lived
// download link for one file. Nothing is changed on the server from here.

export type FileKind = 'masters' | 'renders';

export interface LibraryFile {
    readonly id: string;
    readonly label: string;
    readonly sizeBytes: number | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly seconds: number | null;
    readonly frameRate: number | null;
    readonly createdAt: string | null;
    readonly expiresAt: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// Film masters arrive labelled "Title — 16:9 — sc01-sh01 v2 — 16:9 master": the shot code is an internal id and the shape appears twice.
// Parts that are a shot code are dropped and repeated parts are kept once.
export function cleanLabel(label: string | null): string | null {
    if (!label) return null;
    const seen = new Set<string>();
    const parts = label.split(/\s+[—–]\s+/).map(p => p.trim()).filter(p => {
        if (!p || /^sc\d+-sh\d+(\s+v\d+)?$/i.test(p)) return false;
        const key = p.toLowerCase().replace(/\s*master$/, '');
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });
    return parts.length ? parts.join(' — ') : null;
}

// Rows that still read the same get their creation date and time so they can be told apart.
function tellApart(files: LibraryFile[]): LibraryFile[] {
    const counts = new Map<string, number>();
    for (const f of files) counts.set(f.label, (counts.get(f.label) ?? 0) + 1);
    return files.map(f => {
        if ((counts.get(f.label) ?? 0) < 2 || !f.createdAt || Number.isNaN(Date.parse(f.createdAt))) return f;
        return { ...f, label: `${f.label} · ${new Date(f.createdAt).toLocaleString(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' })}` };
    });
}

export function parseFiles(body: unknown, kind: FileKind): { enabled: boolean; files: LibraryFile[] } {
    const b = isObject(body) ? body : {};
    if (b.enabled !== true) return { enabled: false, files: [] };
    const list = Array.isArray(b[kind]) ? (b[kind] as unknown[]) : [];
    const files: LibraryFile[] = [];
    for (const raw of list) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        if (!id) continue;
        files.push({
            id,
            label: cleanLabel(str(raw.label)) ?? t('libraryFiles.untitledvideo'),
            sizeBytes: num(raw.size_bytes),
            width: num(raw.width),
            height: num(raw.height),
            seconds: num(raw.seconds),
            frameRate: num(raw.frame_rate),
            createdAt: str(raw.created_at),
            expiresAt: str(raw.expires_at),
        });
    }
    return { enabled: true, files: tellApart(files) };
}

export function sizeLabel(bytes: number | null): string | null {
    if (bytes === null) return null;
    return bytes >= 1_048_576 ? t('libraryFiles.mB', { value1: Math.round(bytes / 1_048_576) }) : t('libraryFiles.kB', { value1: Math.max(1, Math.round(bytes / 1024)) });
}

export function lengthLabel(seconds: number | null): string | null {
    if (seconds === null) return null;
    const whole = Math.round(seconds);
    return whole >= 60 ? t('libraryFiles.mins', { value1: Math.floor(whole / 60), value2: whole % 60 }) : t('libraryFiles.s', { value1: whole });
}

export const resolutionLabel = (width: number | null, height: number | null): string | null => (width !== null && height !== null ? `${width} × ${height}` : null);

export function expiryLabel(expiresAt: string | null, now: Date = new Date()): string | null {
    if (!expiresAt) return null;
    const ms = Date.parse(expiresAt) - now.getTime();
    if (Number.isNaN(ms)) return null;
    if (ms <= 0) return t('libraryFiles.expired');
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return t('libraryFiles.expireswithinthehour');
    if (hours < 24) return plural('libraryFiles.hours', hours);
    const days = Math.floor(hours / 24);
    return plural('libraryFiles.days', days);
}

const PATH: Record<FileKind, string> = { masters: '/api/v1/library/masters', renders: '/api/v1/library/editor-renders' };

export const fetchMasters = async (api: ApiClient) => parseFiles(await api.request(PATH.masters), 'masters');
export const fetchRenders = async (api: ApiClient) => parseFiles(await api.request(PATH.renders), 'renders');

export interface FileLink {
    readonly url: string;
    readonly mimeType: string;
}

// Only an https link to a video is used; the link lasts about 15 minutes and is fetched when the person asks.
export function parseFileLink(body: unknown): FileLink | null {
    if (!isObject(body)) return null;
    const url = str(body.url);
    const mimeType = str(body.mime_type);
    return url && url.startsWith('https://') && mimeType && mimeType.startsWith('video/') ? { url, mimeType } : null;
}

export async function fetchFileLink(api: ApiClient, kind: FileKind, id: string): Promise<FileLink | null> {
    return parseFileLink(await api.request(`${PATH[kind]}/${encodeURIComponent(id)}/asset`));
}

export function fileErrorMessage(err: unknown): string {
    const e = err as { status?: number; code?: string } | null;
    const status = typeof e?.status === 'number' ? e.status : -1;
    const code = String(e?.code ?? '');
    if (status === 0) return t('libraryFiles.noconnectionCheckyourinternetandtry');
    if (status === 404 || code === 'not_found' || code === 'NOT_FOUND') return t('libraryFiles.thatfileisnolongeravailableFiles');
    if (status === 429) return t('libraryFiles.toomanyrequestsTryagainina');
    if (status === 503) return t('libraryFiles.theLibraryisbusyTryagainin');
    return t('libraryFiles.somethingwentwrongTryagain');
}
