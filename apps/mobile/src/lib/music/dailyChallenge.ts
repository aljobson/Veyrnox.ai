import { isRecord } from '../responseShapes';
import type { MusicDailyChallenge } from './types';

// Must equal the server v1 descriptor order; the cross-platform drift test enforces it.
export const MUSIC_DAILY_CHALLENGE_DESCRIPTOR_KEYS = [
    'glass-after-rain', 'one-room-orchestra', 'midnight-machines', 'paper-satellites',
    'velvet-steps', 'gravity-in-reverse', 'copper-sunrise',
] as const;
const keySet = new Set<string>(MUSIC_DAILY_CHALLENGE_DESCRIPTOR_KEYS);
const idPattern = /^v1:(\d{4}-\d{2}-\d{2}):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function isMusicDailyChallenge(value: unknown): value is MusicDailyChallenge {
    if (!isRecord(value) || value.catalog_version !== 'v1' || value.no_reward !== true
        || typeof value.id !== 'string' || typeof value.date !== 'string' || typeof value.reset_at !== 'string'
        || typeof value.title_key !== 'string' || typeof value.prompt_key !== 'string') return false;
    const match = idPattern.exec(value.id);
    if (!match || match[1] !== value.date || !keySet.has(match[2])) return false;
    const start = Date.parse(`${value.date}T00:00:00.000Z`);
    if (!Number.isFinite(start) || new Date(start).toISOString() !== `${value.date}T00:00:00.000Z`
        || new Date(start + 86400000).toISOString() !== value.reset_at) return false;
    return value.title_key === `music.dailyChallenge.prompt.${match[2]}.title`
        && value.prompt_key === `music.dailyChallenge.prompt.${match[2]}.prompt`;
}

export function isCurrentMusicDailyChallenge(value: MusicDailyChallenge, now = Date.now()): boolean {
    const start = Date.parse(`${value.date}T00:00:00.000Z`);
    const reset = Date.parse(value.reset_at);
    return Number.isFinite(now) && start <= now && now < reset;
}
