import type { ApiClient } from './api';
import { getCacheUser, appCache, subscribeCacheUser } from './appCache';
import type { CachePolicy } from './cache';
export const YOUR_WINS_ENABLED = process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED === 'true';
export type MilestoneKey = 'first_image' | 'first_video' | 'creations_10' | 'creations_50' | 'first_post' | 'first_cinema_upload' | 'streak_7';
export type WinsMilestone = { key: MilestoneKey; reached_at: string | null; progress: number; target: number };
export type WinsPeriod = { creations: { total: number; by_type: { image: number; video: number; audio: number; other: number } }; video_seconds: number; credits_used: number; posts: number; views: { total: number; networks: string[] } | null };
export type YourWins = { ok: true; week_start: string; week: WinsPeriod; all: WinsPeriod; streak?: { current: number; best: number; last7: boolean[] }; milestones: WinsMilestone[] };
export const winsPolicy: CachePolicy = { name: 'your-wins', perUser: true, freshMs: 5 * 60_000, maxAgeMs: 86400000 };
export const winsSeenPolicy: CachePolicy = { name: 'your-wins-seen', perUser: true, freshMs: 0, maxAgeMs: 3650 * 86400000 };
export const nextMilestone = (data: YourWins) => data.milestones.find(m => !m.reached_at) ?? null;
const pending = new Map<string, Promise<{ data: YourWins | null; fetched: boolean }>>();
const memory = new Map<string, { at: number; data: YourWins | null }>();
subscribeCacheUser(() => { memory.clear(); pending.clear(); });
export async function fetchYourWins(api: ApiClient, onFetched?: (data: YourWins | null) => void): Promise<YourWins | null> {
    const owner = getCacheUser();
    if (!YOUR_WINS_ENABLED || !owner) return null;
    const saved = memory.get(owner);
    if (saved && Date.now() - saved.at < winsPolicy.freshMs) return saved.data;
    let request = pending.get(owner);
    if (!request) {
        request = (async () => {
            const cached = await appCache.read<YourWins | null>(winsPolicy, owner);
            if (owner !== getCacheUser()) return { data: null, fetched: false };
            if (cached && !cached.meta.stale) {
                memory.set(owner, { at: cached.meta.savedAt, data: cached.value });
                return { data: cached.value, fetched: false };
            }
            let data: YourWins | null = null;
            try { const response = await api.request<YourWins>('/api/v1/wins'); data = response?.ok === true ? response : null; } catch {}
            if (owner !== getCacheUser()) return { data: null, fetched: false };
            memory.set(owner, { at: Date.now(), data });
            await appCache.write(winsPolicy, data, owner).catch(() => undefined);
            return { data: owner === getCacheUser() ? data : null, fetched: true };
        })().finally(() => pending.delete(owner));
        pending.set(owner, request);
    }
    const result = await request;
    if (owner !== getCacheUser()) return null;
    if (result.fetched) onFetched?.(result.data);
    return result.data;
}
export function winsSeenDiff(milestones: WinsMilestone[], seen: string[] | null) {
    const reached = milestones.filter(m => m.reached_at);
    return { seen: [...new Set([...(seen ?? []), ...reached.map(m => m.key)])],
        newest: seen === null ? null : reached.filter(m => m.key !== 'first_image' && m.key !== 'first_video' && !seen.includes(m.key))
            .sort((a, b) => Date.parse(b.reached_at!) - Date.parse(a.reached_at!))[0] ?? null };
}
