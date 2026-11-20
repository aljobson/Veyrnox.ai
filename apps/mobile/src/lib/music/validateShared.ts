import { isRecord } from '../responseShapes';
import { exact, publicDate, publicInteger, publicText } from './validatePublic';
export const listenToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export interface SharedSong { title: string; version_number: number; created_at: string; audio_url: string }
export function isSharedSong(v: unknown, token: string): v is { song: SharedSong } {
    if (!listenToken(token) || !isRecord(v) || !exact(v, ['song']) || !isRecord(v.song)) return false;
    const s = v.song;
    return exact(s, ['title', 'version_number', 'created_at', 'audio_url']) && publicText(s.title, 120)
        && publicInteger(s.version_number) && s.version_number > 0 && publicDate(s.created_at)
        && s.audio_url === `/api/music/shared/${token}/asset`;
}
