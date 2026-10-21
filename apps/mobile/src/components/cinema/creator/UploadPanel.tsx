import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'expo-router';
import { AccessibilityInfo, Alert, AppState, Linking, Pressable, Text, View } from 'react-native';
import { FileMode, type FileHandle } from 'expo-file-system';
import { useAuth } from '../../../auth/AuthProvider';
import { SUPPORT_EMAIL } from '../../../lib/account';
import { ApiError } from '../../../lib/api';
import { bodyKeys, creatorMessage, jsonWrite } from '../../../lib/cinemaDrafts';
import { cleanupFor, readUpload, runTransfer, type UploadReply } from '../../../lib/cinemaUpload';
import { cinemaUploadStore as store, type UploadRecord } from '../../../lib/cinemaUploadStore';
import { t } from '../../../lib/i18n';
import { Action, CreatorClosed, ui, useCreatorScope, WebLink } from './RulesLinks';

export const SUPPORT_MAIL_URL = `mailto:${SUPPORT_EMAIL}`;
// A staged file is re-hashed once per app launch; pick() has just hashed what it saves.
const verifiedThisLaunch = new Set<string>();
const verifiedKey = (record: UploadRecord) => `${record.staged}:${record.fingerprint}`;
export const markVerified = (record: UploadRecord) => { verifiedThisLaunch.add(verifiedKey(record)); };
export async function stagedValid(ticket: ReturnType<typeof store.ticket>, record: UploadRecord) {
    if (verifiedThisLaunch.has(verifiedKey(record))) return true;
    const valid = await store.verify(ticket, record);
    if (valid) markVerified(record);
    return valid;
}

export function UploadPanel({ contentId, editable, onChange }: { contentId: string; editable: boolean; onChange(): void }) {
    const { api } = useAuth(), scope = useCreatorScope();
    const [reply, setReply] = useState<UploadReply | null>(null), [record, setRecord] = useState<UploadRecord | null>(null);
    const [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(false), [checking, setChecking] = useState(true);
    const [missing, setMissing] = useState(false), [note, setNote] = useState(''), [closed, setClosed] = useState(false);
    const current = useRef<UploadRecord | null>(null), running = useRef(false), stop = useRef(false), paused = useRef(false);
    const cancel = useRef(false), resumeOnActive = useRef(false), active = useRef(AppState.currentState !== 'background');
    const handle = useRef<FileHandle | null>(null), announced = useRef(-1), keys = useRef(bodyKeys()).current;
    const removalKeys = useRef(new Map<string, string>()), runningTitle = useSyncExternalStore(store.subscribe, store.running, () => null);
    const closeHandle = () => { handle.current?.close(); handle.current = null; };
    const updateRecord = (value: UploadRecord | null) => { current.current = value; if (scope.live()) setRecord(value); };
    const clear = async () => {
        closeHandle(); await store.clear(scope.ticket, contentId);
        if (!store.live(scope.ticket)) return;
        updateRecord(null); if (scope.live()) setMissing(false);
    };
    const showError = (e: unknown) => {
        if (!scope.live()) return;
        const message = creatorMessage(e); setNote(message);
        if (message === 'cinemaUpload.role' || (e instanceof ApiError && ['uploads_not_open', 'upload_not_allowed'].includes(e.code))) setClosed(true);
    };
    const acceptReply = async (data: UploadReply) => {
        if (!scope.live()) return;
        setReply(data);
        if (data.upload && cleanupFor('read', data.upload.state) === 'delete') await clear();
    };
    const refresh = async () => {
        const body = { content_id: contentId };
        try {
            const data = await jsonWrite<UploadReply>(api, '/api/v1/cinema/uploads/refresh', body, keys.for(body));
            if (!store.live(scope.ticket)) return;
            keys.finish(body);
            if (scope.live()) { await acceptReply(data); if (scope.live()) onChange(); }
        } catch (e) { if (store.live(scope.ticket)) keys.finish(body, e); throw e; }
    };
    const progress = (value: UploadRecord) => {
        if (!scope.live()) return;
        updateRecord(value);
        const percent = Math.floor(value.offset / value.size * 100), bucket = Math.floor(percent / 10);
        if (bucket > announced.current) { announced.current = bucket; AccessibilityInfo.announceForAccessibility(`${bucket * 10}%`); }
    };
    const begin = async () => {
        const saved = current.current;
        if (!scope.live() || !saved || running.current || !editable || !active.current) return;
        const release = store.acquire(scope.ticket, contentId); if (!release) { setNote('cinemaUpload.another'); return; }
        running.current = true; stop.current = false; paused.current = false; cancel.current = false;
        resumeOnActive.current = false; setBusy(true); setNote('');
        try {
            setChecking(true);
            const valid = await stagedValid(scope.ticket, saved); if (!scope.live()) return;
            setChecking(false);
            if (!valid) { setMissing(true); setNote('cinemaUpload.sameVideo'); return; }
            if (stop.current) return;
            const ready = { ...saved, pausedByUser: false };
            await store.save(scope.ticket, ready); if (!scope.live()) return;
            updateRecord(ready); handle.current = store.file(scope.ticket, ready).open(FileMode.ReadOnly);
            const result = await runTransfer({
                api, record: ready, file: handle.current, live: () => store.live(scope.ticket), stopped: () => stop.current,
                sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
                save: async value => {
                    const next = { ...value, pausedByUser: paused.current };
                    await store.save(scope.ticket, next); if (store.live(scope.ticket)) updateRecord(next);
                }, clear, refresh, onError: showError,
                onUpload: upload => { if (scope.live()) setReply(r => ({ ...r, upload, proxy_uploads_enabled: r?.proxy_uploads_enabled ?? false })); },
                onProgress: value => progress({ ...value, pausedByUser: paused.current }),
            });
            if (scope.live() && result === 'paused') setNote('cinemaUpload.localPaused');
        } catch (e) { showError(e); }
        finally {
            closeHandle();
            if (cancel.current && store.live(scope.ticket)) await clear();
            running.current = false; release();
            if (scope.live()) {
                setBusy(false); setChecking(false);
                if (resumeOnActive.current && active.current && !paused.current && current.current) void begin();
            }
        }
    };
    useEffect(() => {
        let mounted = true;
        void (async () => {
            try {
                const saved = await store.read(scope.ticket, contentId); if (!mounted || !scope.live()) return;
                updateRecord(saved); paused.current = saved?.pausedByUser ?? false;
                if (saved) {
                    const valid = await stagedValid(scope.ticket, saved); if (!mounted || !scope.live()) return;
                    setMissing(!valid); if (!valid) setNote('cinemaUpload.sameVideo');
                }
                const data = await readUpload(api, contentId); if (!mounted || !scope.live()) return;
                await acceptReply(data);
            } catch (e) { if (mounted) showError(e); }
            finally { if (mounted && scope.live()) setChecking(false); }
        })();
        const subscription = AppState.addEventListener('change', state => {
            active.current = state === 'active';
            if (state === 'background') { if (running.current) resumeOnActive.current = true; stop.current = true; }
            if (state === 'active' && resumeOnActive.current && !running.current && !paused.current && scope.live()) void begin();
        });
        const unsubscribe = store.subscribe(() => { if (!store.live(scope.ticket)) stop.current = true; });
        return () => { mounted = false; stop.current = true; resumeOnActive.current = false; subscription.remove(); unsubscribe(); };
    }, [contentId]);
    const choosing = useRef(false);
    const choose = async () => {
        if (choosing.current || !scope.live()) return;
        choosing.current = true;
        setPreparing(true); setNote('');
        try {
            const next = await store.pick(scope.ticket, contentId, current.current); if (!scope.live() || !next) return;
            markVerified(next); updateRecord(next); setMissing(false); await begin();
        } catch (e) { showError(e); }
        finally { choosing.current = false; if (scope.live()) setPreparing(false); }
    };
    const pause = async () => {
        stop.current = true; paused.current = true; resumeOnActive.current = false;
        if (current.current) {
            const next = { ...current.current, pausedByUser: true }; updateRecord(next);
            await store.save(scope.ticket, next);
        }
    };
    const discard = (outcome: string) => {
        if (!scope.live() || (store.running() === contentId && !running.current) || cleanupFor('user', outcome) !== 'delete') return;
        cancel.current = true; stop.current = true; resumeOnActive.current = false;
        if (!running.current) void clear().catch(showError);
    };
    const remove = async () => {
        const uploadId = reply?.upload?.id;
        if (!scope.live() || !uploadId || store.running() === contentId) return;
        setBusy(true);
        const body = { content_id: contentId, upload_id: uploadId };
        if (!removalKeys.current.has(uploadId)) removalKeys.current.set(uploadId, keys.for(body));
        try {
            const data = await jsonWrite<UploadReply>(api, '/api/v1/cinema/uploads/remove', body, removalKeys.current.get(uploadId)!);
            if (!scope.live()) return;
            if (cleanupFor('remove', 'remove_accepted') === 'delete') await clear();
            if (!scope.live()) return;
            setReply(data); setNote(''); onChange();
        } catch (e) { showError(e); }
        finally { if (scope.live()) setBusy(false); }
    };
    const confirm = (label: string, message: string, action: () => void) => Alert.alert(t(label), t(message), [
        { text: t('cinemaUpload.keep'), style: 'cancel' }, { text: t(label), style: 'destructive', onPress: action },
    ]);
    if (closed) return <CreatorClosed message={note || 'cinemaUpload.closed'} />;
    const upload = reply?.upload, other = runningTitle && !running.current;
    const leasedElsewhere = runningTitle === contentId && !running.current;
    const canChoose = editable && !closed && reply?.proxy_uploads_enabled && (!upload || upload.state === 'uploading');
    return <View style={ui.card}>
        <Text style={ui.text}>{t(checking ? 'cinemaUpload.checking' : preparing ? 'cinemaUpload.preparing' : `cinemaUpload.upload.${upload?.state ?? 'none'}`)}</Text>
        <Text style={ui.text}>{t('cinemaUpload.keepOpen')}</Text>
        {note ? <Text style={ui.text}>{t(note)}</Text> : null}
        {reply && !reply.proxy_uploads_enabled && !closed && <Text style={ui.text}>{t('cinemaUpload.paused')}</Text>}
        {other && <><Text style={ui.text}>{t('cinemaUpload.another')}</Text><Link style={ui.button} href={{ pathname: '/cinema/creator/[id]', params: { id: runningTitle } }}><Text style={ui.link}>{t('cinemaUpload.openRunning')}</Text></Link></>}
        {record && <View accessibilityRole="progressbar" accessibilityLabel={t('cinemaUpload.progressLabel')} accessibilityValue={{ min: 0, max: 100, now: Math.floor(record.offset / record.size * 100) }}>
            <Text style={ui.text}>{t('cinemaUpload.progress', { percent: Math.floor(record.offset / record.size * 100), sent: (record.offset / 1000000).toFixed(1), total: (record.size / 1000000).toFixed(1) })}</Text>
        </View>}
        {canChoose && (!record || missing) && <Action label={t('cinemaUpload.files')} disabled={busy || preparing || checking || leasedElsewhere} onPress={() => void choose()} />}
        {canChoose && record && !missing && <Action label={t('cinemaUpload.resume')} disabled={busy || preparing || checking || !!other} onPress={() => void begin()} />}
        {busy && running.current && <Action label={t('cinemaUpload.pause')} onPress={() => void pause().catch(showError)} />}
        {record && <Action label={t('cinemaUpload.cancel')} disabled={leasedElsewhere} onPress={() => confirm('cinemaUpload.cancel', 'cinemaUpload.cancelConfirm', () => discard('cancel_confirmed'))} />}
        {note === 'cinemaUpload.different' && <Action label={t('cinemaUpload.discard')} disabled={busy || leasedElsewhere} onPress={() => confirm('cinemaUpload.discard', 'cinemaUpload.discardConfirm', () => discard('discard_confirmed'))} />}
        {note === 'cinemaUpload.support' && <Pressable accessibilityRole="link" accessibilityLabel={t('cinemaUpload.supportLink')} style={ui.button} onPress={() => void Linking.openURL(SUPPORT_MAIL_URL)}><Text style={ui.link}>{t('cinemaUpload.supportLink')}</Text></Pressable>}
        {!closed && <Action label={t('cinemaUpload.refresh')} disabled={busy || preparing || checking || leasedElsewhere} onPress={() => { if (scope.live()) { setBusy(true); void refresh().catch(showError).finally(() => { if (scope.live()) setBusy(false); }); } }} />}
        {!closed && upload && !['provisioning', 'deleting'].includes(upload.state) && <Action label={t('cinemaUpload.remove')} disabled={busy || preparing || checking || leasedElsewhere} onPress={() => confirm('cinemaUpload.remove', 'cinemaUpload.removeConfirm', () => void remove())} />}
        <WebLink />
    </View>;
}
