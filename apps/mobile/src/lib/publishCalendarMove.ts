import { ApiError } from './api';
import type { PublishPost, PublishRole } from './publish';
import { dayKey, type CalendarPost } from './publishCalendar';
import { postActions } from './publishComposeGates';

export const canMove = (post: CalendarPost, role: PublishRole | null): boolean =>
    role !== null && postActions(post, role).reschedule && post.canReschedule && !!post.scheduledAt;

export function droppedAt(post: CalendarPost, key: string): Date | null {
    if (!post.scheduledAt || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const old = new Date(post.scheduledAt);
    if (dayKey(old) === key) return null;
    const [y, m, d] = key.split('-').map(Number);
    const when = new Date(y, m - 1, d, old.getHours(), old.getMinutes());
    return dayKey(when) === key && when.getHours() === old.getHours() && when.getMinutes() === old.getMinutes() ? when : null;
}
export type DropRect = { key: string; x: number; y: number; width: number; height: number };
export const dropTarget = (x: number, y: number, rects: DropRect[]): string | null =>
    rects.find(r => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height)?.key ?? null;
export function moveAttempt(post: CalendarPost, when: Date) {
    return Object.freeze({ postId: post.id, expectedAt: post.scheduledAt as string, scheduledAt: when.toISOString() });
}
export type MoveAttempt = ReturnType<typeof moveAttempt>;
export function moveOutcome(err: unknown): 'refused' | 'changed' | 'unknown' {
    if (!(err instanceof ApiError) || err.status === 0 || err.status === 408) return 'unknown';
    if (err.status === 503 && ['calendar_not_open', 'supabase_not_configured'].includes(err.code)) return 'refused';
    if (err.status >= 500) return 'unknown';
    if (err.status === 409 && err.code === 'SCHEDULE_CHANGED') return 'changed';
    return err.status >= 400 && err.status < 500 ? 'refused' : 'unknown';
}
export function serverHolds(post: PublishPost | null, attempt: MoveAttempt): 'new' | 'old' | 'other' | 'started' | 'canceled' | 'unscheduled' | 'gone' {
    if (!post) return 'gone';
    if (post.status === 'canceled') return 'canceled';
    if (['published', 'failed'].includes(post.status) || (post.status === 'scheduled' && post.targets.some(t => t.publishStatus !== 'pending'))) return 'started';
    if (post.status !== 'scheduled') return 'unscheduled';
    const at = Date.parse(post.scheduledAt ?? '');
    return at === Date.parse(attempt.scheduledAt) ? 'new' : at === Date.parse(attempt.expectedAt) ? 'old' : 'other';
}
export const pendingDelays = [2000, 4000, 8000, 16000] as const;
export const moveProblem = (when: Date, now: Date) => when.getTime() <= now.getTime() + 60_000 ? 'publish.chooseatimeinthefutureat' : null;
export function overlay(posts: readonly CalendarPost[], moves: ReadonlyMap<string, { attempt: MoveAttempt; phase: 'sending' | 'pending' }>): CalendarPost[] {
    return posts.map(post => {
        const move = moves.get(post.id);
        return move ? { ...post, scheduledAt: move.attempt.scheduledAt, movePhase: move.phase } : post;
    });
}
