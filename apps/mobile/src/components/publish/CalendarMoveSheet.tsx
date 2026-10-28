import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { dateText, timeText, WhenPicker, whenFrom } from '../WhenPicker';
import { ApiError, type ApiClient } from '../../lib/api';
import { fetchPost, type PublishPost } from '../../lib/publish';
import type { CalendarPost } from '../../lib/publishCalendar';
import { moveAttempt, moveOutcome, moveProblem, pendingDelays, serverHolds, type MoveAttempt } from '../../lib/publishCalendarMove';
import { composeErrorMessage, reschedulePost } from '../../lib/publishCompose';
import { publishScope } from '../../lib/usePublishRole';
import { subscribeCacheUser } from '../../lib/appCache';
import { brandStore } from '../../lib/publishBrand';
import { formatLocale, t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';

type Entry = {
    token: object; attempt: MoveAttempt; before: string | null; post: CalendarPost; phase: 'sending' | 'pending';
    scope: { publishScope: string; api: ApiClient; epoch: number }; busy: boolean; checks: number;
    timer?: ReturnType<typeof setTimeout>; exhausted: boolean;
};
type Sheet = { post: CalendarPost; date: string; time: string; attempt?: MoveAttempt; message?: string; action?: 'retry' | 'reload'; edited?: boolean };
export const moveTime = (at: string | null) => at ? new Date(at).toLocaleString(formatLocale(undefined)) : '—';
const postName = (post: CalendarPost) => post.text.slice(0, 40) || t('calendar.noText');

export function useCalendarMoves(api: ApiClient, posts: CalendarPost[] | null, setPosts: Dispatch<SetStateAction<CalendarPost[] | null>>, reload: () => void, cancelDrag: () => void) {
    const entries = useRef(new Map<string, Entry>()), epoch = useRef(0), currentApi = useRef(api), livePosts = useRef(posts);
    currentApi.current = api; livePosts.current = posts;
    const [, render] = useState(0), [sheet, setSheet] = useState<Sheet | null>(null);
    const [notice, setNotice] = useState({ postId: '', text: '' });
    const setMessage = (text: string, postId: string) => setNotice({ postId, text });
    const sheetRef = useRef(sheet); sheetRef.current = sheet;
    const update = () => render(n => n + 1);
    const valid = (e: Entry) => entries.current.get(e.attempt.postId)?.token === e.token && e.scope.epoch === epoch.current && e.scope.api === currentApi.current && e.scope.publishScope === publishScope();
    const reset = useCallback(() => {
        epoch.current++;
        entries.current.forEach(e => clearTimeout(e.timer)); entries.current.clear();
        cancelDrag(); setSheet(null); setNotice({ postId: '', text: '' }); render(n => n + 1);
    }, [cancelDrag]);
    useEffect(() => {
        reset();
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { epoch.current++; entries.current.forEach(e => clearTimeout(e.timer)); entries.current.clear(); userOff(); brandOff(); cancelDrag(); };
    }, [api, reset, cancelDrag]);
    const tellSheet = (id: string, patch: Partial<Sheet>) => setSheet(s => s?.post.id === id ? { ...s, ...patch } : s);
    function remove(e: Entry) { clearTimeout(e.timer); entries.current.delete(e.attempt.postId); update(); }
    function resolve(e: Entry, post: PublishPost | null, result: Exclude<ReturnType<typeof serverHolds>, 'old'>, scheduleOnly = false) {
        if (!valid(e)) return;
        remove(e);
        setPosts(rows => rows?.flatMap(row => row.id !== e.attempt.postId ? [row] : post ? [scheduleOnly ? { ...row, scheduledAt: post.scheduledAt } : { ...row, scheduledAt: post.scheduledAt, status: post.status, targets: post.targets }] : []) ?? null);
        const key = result === 'new' ? 'done' : result === 'other' ? 'serverHas' : result;
        const text = result === 'gone' ? `${postName(e.post)}: ${t('publishCompose.thatpostisnolongerthere')}` : t(`publishTiming.move.${key}`, { post: postName(e.post), time: moveTime(post?.scheduledAt ?? null) });
        setMessage(text, e.attempt.postId);
        if (result === 'new') setSheet(s => s?.post.id === e.attempt.postId ? null : s);
        else tellSheet(e.attempt.postId, { message: text, action: 'reload' });
        reload();
    }
    function success(e: Entry, at?: string) { resolve(e, { ...e.post, scheduledAt: at ?? e.attempt.scheduledAt }, 'new', true); }
    function schedule(e: Entry) {
        if (!valid(e) || e.timer || e.busy) return;
        if (e.checks >= pendingDelays.length) {
            if (!e.exhausted) setMessage(t('publishTiming.move.stillPending', { post: postName(e.post), time: moveTime(e.attempt.scheduledAt) }), e.attempt.postId);
            e.exhausted = true; update(); return;
        }
        e.timer = setTimeout(() => { e.timer = undefined; if (valid(e)) void check(e, true); }, pendingDelays[e.checks]);
    }
    async function read(e: Entry, definiteOld = false) {
        let post: PublishPost | null;
        try { post = await fetchPost(e.scope.api, e.attempt.postId); }
        catch (err) {
            if (!valid(e)) return;
            if (err instanceof ApiError && err.status === 404) post = null;
            else return;
        }
        if (!valid(e)) return;
        const result = serverHolds(post, e.attempt);
        if (result !== 'old') resolve(e, post, result);
        else if (definiteOld) {
            remove(e);
            const text = composeErrorMessage(new ApiError(409, 'SCHEDULE_CHANGED'));
            tellSheet(e.attempt.postId, { message: text, action: 'reload' });
            setMessage(`${postName(e.post)}: ${text}`, e.attempt.postId);
        }
    }
    async function check(e: Entry, automatic = false) {
        if (!valid(e) || e.busy) return;
        clearTimeout(e.timer); e.timer = undefined;
        e.busy = true; if (automatic) e.checks++; update();
        await read(e);
        if (!valid(e)) return;
        e.busy = false; update(); schedule(e);
    }
    async function send(e: Entry, replay = false) {
        if (!valid(e) || e.busy) return;
        clearTimeout(e.timer); e.timer = undefined;
        e.busy = true; update();
        try {
            const reply = await reschedulePost(e.scope.api, e.attempt.postId, e.attempt.expectedAt, new Date(e.attempt.scheduledAt));
            if (valid(e)) success(e, reply.scheduled_at);
        } catch (err) {
            if (!valid(e)) return;
            const outcome = moveOutcome(err);
            if (replay) await read(e);
            else if (outcome === 'refused') {
                remove(e);
                const text = composeErrorMessage(err);
                tellSheet(e.attempt.postId, { message: text, action: err instanceof ApiError && err.status === 429 ? 'retry' : err instanceof ApiError && err.status === 409 ? 'reload' : undefined });
                setMessage(`${postName(e.post)}: ${text}`, e.attempt.postId);
            } else {
                e.phase = 'pending';
                if (outcome === 'changed') await read(e, true);
                if (valid(e)) setMessage(t('publishTiming.move.pending', { post: postName(e.post), time: moveTime(e.attempt.scheduledAt) }), e.attempt.postId);
            }
        } finally {
            if (valid(e)) { e.busy = false; update(); if (e.phase === 'pending') schedule(e); }
        }
    }
    function submit() {
        const s = sheetRef.current;
        if (!s || entries.current.has(s.post.id)) return;
        const when = whenFrom(s.date, s.time);
        const problem = when ? moveProblem(when, new Date()) : 'publish.chooseatimeinthefutureat';
        if (problem || !when) { tellSheet(s.post.id, { message: t(problem!) }); return; }
        const post = livePosts.current?.find(p => p.id === s.post.id) ?? s.post;
        const attempt = s.attempt && !s.edited ? s.attempt : moveAttempt(post, when);
        tellSheet(s.post.id, { attempt, edited: false, message: undefined, action: undefined });
        const e: Entry = { token: {}, post, attempt, before: post.scheduledAt, phase: 'sending', busy: false, checks: 0, exhausted: false, scope: { publishScope: publishScope(), api, epoch: epoch.current } };
        entries.current.set(post.id, e); update(); void send(e);
    }
    const open = (post: CalendarPost, when: Date) => {
        if (entries.current.has(post.id)) return;
        setSheet({ post, date: dateText(when), time: timeText(when) });
    };
    const marker = (id: string) => {
        const e = entries.current.get(id);
        return e ? t(`publishTiming.move.${e.phase === 'sending' ? 'sending' : e.exhausted ? 'stillPending' : 'pending'}`, { post: postName(e.post), time: moveTime(e.attempt.scheduledAt) }) : null;
    };
    const entry = sheet ? entries.current.get(sheet.post.id) : undefined;
    return {
        moves: entries.current, sheet, entry, message: notice.text, announcementPostId: notice.postId, marker, open, submit,
        currentPost: sheet ? posts?.find(p => p.id === sheet.post.id) ?? sheet.post : null,
        close: () => { if (!entry?.busy) setSheet(null); },
        edit: (date: string, time: string) => { if (!entry) setSheet(s => s ? { ...s, date, time, edited: true, action: undefined, message: undefined } : s); },
        check: () => { if (entry) void check(entry); },
        checkPost: (id: string) => {
            const e = entries.current.get(id);
            if (!e || e.busy) return;
            const when = new Date(e.attempt.scheduledAt);
            setSheet({ post: e.post, date: dateText(when), time: timeText(when), attempt: e.attempt });
            void check(e);
        },
        retry: () => { if (entry) { if (!moveProblem(new Date(entry.attempt.scheduledAt), new Date())) void send(entry, true); } else submit(); },
        reload: () => { setSheet(null); reload(); },
    };
}
export function CalendarMoveSheet({ move }: { move: ReturnType<typeof useCalendarMoves> }) {
    // A different post gets a fresh deduplication scope, even with identical captions and times.
    // Keep this mounted when the sheet closes so successful moves are still announced.
    return <><MoveAnnouncement key={move.announcementPostId} message={move.message} /><MoveSheetContent move={move} /></>;
}
function MoveAnnouncement({ message }: { message: string }) {
    useAnnouncement(message, { onMount: true });
    return null;
}
function MoveSheetContent({ move }: { move: ReturnType<typeof useCalendarMoves> }) {
    const styles = useThemedStyles(sheets), { sheet, entry, currentPost } = move;
    const [clock, setClock] = useState(Date.now);
    useEffect(() => {
        if (!entry || moveProblem(new Date(entry.attempt.scheduledAt), new Date())) return;
        const delay = Math.min(60_000, Math.max(1, Date.parse(entry.attempt.scheduledAt) - Date.now() - 60_000));
        const timer = setTimeout(() => setClock(Date.now()), delay);
        return () => clearTimeout(timer);
    }, [entry, clock]);
    if (!sheet || !currentPost) return null;
    const busy = entry?.busy ?? false, pending = entry?.phase === 'pending';
    const chosen = entry?.attempt.scheduledAt ?? whenFrom(sheet.date, sheet.time)?.toISOString() ?? null;
    return <Modal visible transparent animationType="none" onRequestClose={move.close}>
        <View style={styles.backdrop}><ScrollView style={styles.panel} contentContainerStyle={styles.content} accessibilityViewIsModal>
            <Text accessibilityRole="header" variant="bodyStrong">{t('publishTiming.move.title')}</Text>
            <Text>{currentPost.text.slice(0, 80) || t('calendar.noText')}</Text>
            <Text>{t('publishTiming.move.now', { time: moveTime(currentPost.scheduledAt) })}</Text>
            <Text>{t('publishTiming.move.new', { time: moveTime(chosen), zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</Text>
            {entry ? <><Text>{t('publishTiming.move.expected', { time: moveTime(entry.attempt.expectedAt) })}</Text><Text>{move.marker(currentPost.id)}</Text></> : sheet.action === 'reload' ? null : <WhenPicker date={sheet.date} time={sheet.time} onChange={move.edit} />}
            {sheet.message ? <Text>{sheet.message}</Text> : null}
            {pending ? <>
                <Button label={t('publishTiming.move.check')} disabled={busy} onPress={move.check} />
                {!moveProblem(new Date(entry.attempt.scheduledAt), new Date()) ? <Button label={t('publishTiming.move.retry')} disabled={busy} onPress={move.retry} /> : null}
            </> : sheet.action === 'reload' ? <Button label={t('publishTiming.move.reload')} disabled={busy} onPress={move.reload} /> : sheet.action === 'retry' ? <Button label={t('publishTiming.move.retry')} disabled={busy} onPress={move.retry} /> : <Button label={t('publishTiming.move.save')} disabled={busy} onPress={move.submit} />}
            <Button variant="secondary" label={t(entry || sheet.message ? 'publishTiming.move.close' : 'publishTiming.move.keep')} disabled={busy} onPress={move.close} />
        </ScrollView></View>
    </Modal>;
}
const sheets = themedStyles(p => ({
    backdrop: { flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 16 },
    panel: { flexGrow: 0, backgroundColor: p.surface, borderRadius: 16 }, content: { padding: 16, gap: 12 },
}));
