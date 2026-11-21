import { actionSong } from './musicActions';
import type { ExportQuote, ExportStart, ExportFile } from '../../src/lib/music/validateExport';
export const exportSong = { ...actionSong, actions: ['download_mp3', 'share_link'] };
export const quote: ExportQuote = { id: '44444444-2222-4333-8444-555555555555', format: 'mp3', consumes_allowance: true,
    allowance: 7, used: 2, remaining_after: 4, expires_at: '2099-01-01T00:00:00Z' };
export const start: ExportStart = { export: { id: '55555555-2222-4333-8444-555555555555', state: 'ready' },
    allowance: { total: 7, used: 3, remaining: 4 }, idempotent: false };
export const file: ExportFile = { id: start.export.id, state: 'ready', format: 'mp3', mime_type: 'audio/mpeg',
    size_bytes: 4096, expires_in: 300, url: 'https://signed.test/song?token=secret' };
export const response = (path: string, init?: RequestInit) => {
    if (path.endsWith('/export-quotes')) return { quote: { ...quote, format: JSON.parse(String(init?.body)).format } };
    if (path.endsWith('/exports')) return start;
    if (path.includes('/music/exports/')) return { export: file };
    return exportSong;
};
