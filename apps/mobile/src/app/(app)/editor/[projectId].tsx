import { randomUUID } from 'expo-crypto';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Pressable, Text, View } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { useAuth } from '../../../auth/AuthProvider';
import { EngineView, type EngineHandle } from '../../../components/editor/EngineView';
import { FullEditorScreen } from '../../../components/editor/FullEditorScreen';
import { useEditorLeaveGuard } from '../../../components/editor/useEditorLeaveGuard';
import { touchTarget } from '../../../lib/a11y';
import { ApiError } from '../../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { config } from '../../../lib/config';
import { documentIdentity, MEDIA_ID, parsePageMessage, PROTOCOL, type ProjectDocument, type EngineImport } from '../../../lib/editorBridge';
import { readDraft, removeDraft, writeDraft } from '../../../lib/editorDrafts';
import { EDITOR_ENABLED, FULL_EDITOR_ENABLED } from '../../../lib/editorFlag';
import { AssetResolutionError, conflictCopyName, createProject, editorErrorKey, getDocument, putDocument, resolveAsset, type DocumentHead } from '../../../lib/editorProjects';
import { editorReducer, initialSession, nextAction, type SessionEvent } from '../../../lib/editorSession';
import { stubEngineHtml } from '../../../lib/editorStubEngine';
import { getLocale, t } from '../../../lib/i18n';
import { isOffline, observe, subscribe } from '../../../lib/network';
import { fetchProject, type Project } from '../../../lib/projects';
import { colors } from '../../../theme';

const ENGINE_BASE_URL = `${new URL(config.apiBase).origin}/app/editor-engine/`;
const html = stubEngineHtml();
const same = (a: unknown, b: unknown) => documentIdentity(a) === documentIdentity(b);
function requestProblem(error: unknown): string {
    const status = (error as ApiError).status;
    return status === 0 ? 'editor.createOffline' : editorErrorKey(status);
}
function Button({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} style={touchTarget} onPress={onPress}><Text style={{ color: colors.accent }}>{label}</Text></Pressable>;
}
export default function EditorRoute() {
    const { projectId, jobId } = useLocalSearchParams<{ projectId: string; jobId?: string }>();
    if (!EDITOR_ENABLED) return <View><Stack.Screen options={{ title: t('editor.title') }} /><Text>{t('editor.unavailable')}</Text></View>;
    if (FULL_EDITOR_ENABLED) return <FullEditorScreen key={projectId} projectId={projectId} jobId={jobId} />;
    return <Editor key={projectId} projectId={projectId} jobId={jobId} />;
}
function Editor({ projectId, jobId }: { projectId: string; jobId?: string }) {
    const { api } = useAuth();
    const router = useRouter();
    const focused = useIsFocused();
    const owner = useRef(getCacheUser());
    const alive = useRef(true);
    const engine = useRef<EngineHandle>(null);
    const accepted = useRef(false);
    const loadSent = useRef(false);
    const state = useRef(initialSession());
    const [session, setSession] = useState(state.current);
    const [project, setProject] = useState<Project | null>(null);
    const [choice, setChoice] = useState<'restore' | 'conflict' | null>(null);
    const choiceRef = useRef(choice);
    const head = useRef<DocumentHead | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [copyBusy, setCopyBusy] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const saving = useRef<Promise<void> | null>(null);
    const writes = useRef<Promise<unknown>>(Promise.resolve());
    const flushWait = useRef<{ nonce: string; promise: Promise<void>; finish(): void } | null>(null);
    const copying = useRef(false);
    const copy = useRef<{ createKey: string; saveKey: string; name: string; document: ProjectDocument; id?: string } | null>(null);
    const current = () => alive.current && owner.current === getCacheUser();
    function dispatch(event: SessionEvent) {
        if (!current()) return;
        state.current = editorReducer(state.current, event);
        setSession(state.current);
    }
    function choose(value: typeof choice) { choiceRef.current = value; setChoice(value); }
    function persist(document = state.current.document): Promise<void> {
        if (!document || !current()) return Promise.resolve();
        const baseRevision = state.current.revision;
        const run = writes.current.catch(() => undefined).then(async () => {
            if (!current()) return;
            const kept = await writeDraft({ owner: owner.current!, projectId, baseRevision, document, updatedAt: Date.now() });
            dispatch({ type: 'local', document, kept });
        });
        writes.current = run;
        return run;
    }
    async function clearConfirmed(document: ProjectDocument) {
        const run = writes.current.catch(() => undefined).then(async () => {
            if (current() && !state.current.dirty && same(state.current.document, document)) await removeDraft(projectId);
        });
        writes.current = run;
        await run.catch(() => undefined);
    }
    function changed(document: ProjectDocument) {
        const previous = state.current;
        dispatch({ type: 'changed', document, key: randomUUID(), now: Date.now() });
        if (state.current !== previous) void persist(document);
    }
    async function showConflict() {
        await flush();
        if (!current()) return;
        choose('conflict');
        try { const latest = await getDocument(api, projectId); if (current()) head.current = latest; }
        catch (err) { if (current()) setProblem(requestProblem(err)); }
    }
    async function save(force = false): Promise<void> {
        if (saving.current) { await saving.current; return; }
        if (!current() || choiceRef.current) return;
        if (force) dispatch({ type: 'retry', now: Date.now() });
        const action = nextAction(state.current, Date.now());
        if (action?.type !== 'save' || action.at > Date.now()) return;
        dispatch({ type: 'save', now: Date.now() });
        const snapshot = state.current.pending;
        if (!snapshot || !state.current.inFlight) return;
        const run = (async () => {
            try {
                const result = await putDocument(api, projectId, snapshot.revision, snapshot.document, snapshot.key);
                if (!current()) return;
                dispatch({ type: 'saved', revision: result.revision });
                if (accepted.current) engine.current?.post({ type: 'saved', revision: result.revision });
                if (state.current.dirty) await persist(); else await clearConfirmed(snapshot.document);
            } catch (err) {
                if (!current()) return;
                const failure = err as ApiError;
                dispatch({ type: 'failed', status: failure.status, retryAfterSeconds: failure.retryAfterSeconds, now: Date.now() });
                if (failure.status === 409) await showConflict();
            }
        })();
        saving.current = run;
        try { await run; } finally { saving.current = null; if (current()) setSession({ ...state.current }); }
    }
    async function flush() {
        if (flushWait.current) return flushWait.current.promise;
        if (!accepted.current || !loadSent.current || !engine.current || choiceRef.current) return;
        const nonce = randomUUID();
        let resolve!: () => void;
        const promise = new Promise<void>(done => { resolve = done; });
        const finish = () => { clearTimeout(timer); flushWait.current = null; resolve(); };
        const timer = setTimeout(finish, 3000);
        flushWait.current = { nonce, promise, finish };
        engine.current.post({ type: 'flush', nonce });
        await promise;
    }
    async function leaveEditor() {
        await flush();
        if (!current()) return true;
        if (state.current.dirty) await persist();
        await saving.current;
        // An older snapshot may have been in flight; save the latest only after it settles.
        if (!['offline', 'paused'].includes(state.current.status)) await save(true);
        if (!current() || !state.current.dirty) return true;
        return new Promise<boolean>(resolve => Alert.alert(t(state.current.localCopy === 'kept' ? 'editor.leaveKept' : 'editor.leaveLost'), undefined, [
            { text: t('editor.stay'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('editor.leave'), style: 'destructive', onPress: () => resolve(true) },
        ], { cancelable: false }));
    }
    const guard = useEditorLeaveGuard(leaveEditor, () => router.back());
    const handlers = useRef({ save, flush, teardown: guard.teardown });
    handlers.current = { save, flush, teardown: guard.teardown };
    async function load() {
        setProblem(null);
        try {
            const [p, server, draft] = await Promise.all([observe(fetchProject(api, projectId)), getDocument(api, projectId), readDraft(projectId)]);
            if (!current()) return;
            if (!p) throw new ApiError(404, 'unavailable');
            head.current = server;
            setProject(p);
            if (draft && !same(draft.document, server.document) && draft.baseRevision <= server.revision) {
                dispatch({ type: 'loaded', document: draft.document, revision: draft.baseRevision });
                // A recovery choice holds autosave and the engine, even if timestamps suggest otherwise.
                state.current = { ...state.current, dirty: true, key: randomUUID(), localCopy: 'kept' };
                setSession(state.current);
                choose(draft.baseRevision < server.revision ? 'conflict' : 'restore');
            } else {
                if (draft) await removeDraft(projectId);
                if (current()) dispatch({ type: 'loaded', ...server });
            }
        } catch (err) { if (current()) setProblem(requestProblem(err)); }
    }
    useEffect(() => {
        void load();
        const unsub = subscribeCacheUser(() => {
            if (owner.current === getCacheUser()) return;
            alive.current = false;
            accepted.current = false;
            state.current = initialSession();
            setSession(state.current); setProject(null); head.current = null; copy.current = null;
            flushWait.current?.finish();
            handlers.current.teardown(() => router.back());
        });
        return () => { alive.current = false; flushWait.current?.finish(); unsub(); };
        // One owner and project per mounted route.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        const sub = AppState.addEventListener('change', next => {
            if (next === 'active' && focused) void handlers.current.save(true);
            if (next === 'background') void handlers.current.flush().then(() => handlers.current.save(true));
        });
        const unsub = subscribe(() => { if (focused && !isOffline() && state.current.status === 'offline') void handlers.current.save(true); });
        return () => { sub.remove(); unsub(); };
    }, [focused]);
    useEffect(() => {
        if (!focused || choice) return;
        const action = nextAction(session, Date.now());
        if (!action) return;
        const timer = setTimeout(() => {
            if (action.type === 'reopen') dispatch({ type: 'reopen' });
            else void handlers.current.save();
        }, Math.max(0, action.at - Date.now()));
        return () => clearTimeout(timer);
    }, [session, focused, choice]);
    const engineVisible = !!project && !!session.document && !session.engineStopped && !choice && !problem && !['protocol_mismatch', 'start_failed', 'unavailable'].includes(session.status);
    useEffect(() => {
        if (!engineVisible) return;
        const timer = setTimeout(() => { if (!accepted.current) dispatch({ type: 'timeout' }); }, 15000);
        return () => clearTimeout(timer);
    }, [engineVisible, session.reloadKey]);
    useEffect(() => {
        if (session.rateLimitedUntil <= Date.now()) return;
        setClock(Date.now());
        const timer = setInterval(() => setClock(Date.now()), 10000);
        return () => clearInterval(timer);
    }, [session.rateLimitedUntil]);
    async function message(event: WebViewMessageEvent) {
        if (!current() || session.reloadKey !== state.current.reloadKey) return;
        const msg = parsePageMessage(event.nativeEvent.data, event.nativeEvent.url, new URL(ENGINE_BASE_URL).origin, projectId);
        if (!msg) return;
        if (msg.type === 'hello') {
            if (accepted.current || state.current.status === 'protocol_mismatch') return;
            dispatch({ type: 'hello', protocol: msg.protocol });
            if (msg.protocol !== PROTOCOL || choiceRef.current || !state.current.document) return;
            accepted.current = true;
            engine.current?.post({ type: 'init', protocol: PROTOCOL, locale: getLocale() });
            const imports: EngineImport[] = jobId && MEDIA_ID.test(`j-${jobId}`) ? [{ mediaId: `j-${jobId}`, kind: 'video' }] : [];
            loadSent.current = true;
            engine.current?.post({ type: 'load', projectId, revision: state.current.revision, document: state.current.document, imports });
            return;
        }
        if (!accepted.current || !loadSent.current || choiceRef.current) return;
        if (msg.type === 'changed') changed(msg.document);
        if (msg.type === 'flushed' && msg.nonce === flushWait.current?.nonce) { changed(msg.document); flushWait.current?.finish(); }
        if (msg.type === 'ready') dispatch({ type: 'ready' });
        if (msg.type === 'error') dispatch({ type: 'timeout' });
        if (msg.type === 'asset-request') {
            const generation = state.current.reloadKey;
            try {
                const asset = await resolveAsset(api, msg.mediaId, Date.now());
                if (current() && accepted.current && state.current.reloadKey === generation) engine.current?.post({ type: 'asset', reqId: msg.reqId, ...asset });
            } catch (err) {
                if (current() && accepted.current && state.current.reloadKey === generation) engine.current?.post({ type: 'asset-error', reqId: msg.reqId, code: err instanceof AssetResolutionError ? err.code : 'unavailable' });
            }
        }
    }
    function killed() {
        accepted.current = false; loadSent.current = false; flushWait.current?.finish();
        dispatch({ type: 'kill', now: Date.now() });
        if (state.current.status === 'killed') dispatch({ type: 'reopen' });
    }
    function reopen() { accepted.current = false; loadSent.current = false; dispatch({ type: 'reopen' }); }
    async function useSaved() {
        try {
            // Refresh on choice, so a failed conflict GET cannot discard work using a stale head.
            const latest = await getDocument(api, projectId);
            if (!current()) return;
            await writes.current;
            await removeDraft(projectId);
            if (!current()) return;
            head.current = latest; copy.current = null;
            dispatch({ type: 'loaded', ...latest }); choose(null); setProblem(null); reopen();
        } catch (err) { if (current()) setProblem(requestProblem(err)); }
    }
    function confirmSaved() {
        Alert.alert(t('editor.confirmDiscard'), undefined, [
            { text: t('editor.stay'), style: 'cancel' },
            { text: t('editor.discard'), style: 'destructive', onPress: () => { void useSaved(); } },
        ]);
    }
    async function keepCopy() {
        if (copying.current || !project?.workspaceId || !state.current.document || Date.now() < state.current.rateLimitedUntil) return;
        copying.current = true; setCopyBusy(true); setProblem(null);
        copy.current ??= { createKey: randomUUID(), saveKey: randomUUID(), document: state.current.document, name: conflictCopyName(project.name) };
        const attempt = copy.current;
        try {
            if (!attempt.id) attempt.id = (await createProject(api, project.workspaceId, attempt.name, attempt.createKey)).id;
            if (!current()) return;
            await putDocument(api, attempt.id, 0, { ...attempt.document, project_id: attempt.id }, attempt.saveKey);
            if (!current()) return;
            await writes.current; await removeDraft(projectId);
            if (current()) guard.teardown(() => router.replace({ pathname: '/editor/[projectId]', params: { projectId: attempt.id! } }));
        } catch (err) {
            if (current()) {
                const failure = err as ApiError;
                if (failure.status === 429) dispatch({ type: 'failed', status: 429, retryAfterSeconds: failure.retryAfterSeconds, now: Date.now() });
                setProblem(requestProblem(failure));
            }
        } finally { copying.current = false; if (current()) setCopyBusy(false); }
    }
    const paused = session.rateLimitedUntil > Date.now();
    const retryLabel = paused ? t('editor.retryIn', { seconds: Math.max(1, Math.ceil((session.rateLimitedUntil - clock) / 1000)) }) : t('editor.retryNow');
    const statusKey = session.dirty && session.localCopy === 'failed' ? 'editor.notKept'
        : session.status === 'saving' ? 'editor.saving' : paused ? 'editor.paused'
        : session.status === 'offline' ? 'editor.offline' : session.status === 'rejected' ? 'editor.rejected' : session.dirty ? 'editor.retry' : 'editor.saved';
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 12 }}>
        <Stack.Screen options={{ title: t('editor.title') }} />
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20 }}>{project?.name ?? t('editor.title')}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.body }}>{t(statusKey)}</Text>
        <Button label={t('editor.done')} onPress={guard.done} />
        {engineVisible && <EngineView ref={engine} html={html} baseUrl={ENGINE_BASE_URL} reloadKey={session.reloadKey} onMessage={message} onKilled={killed} />}
        {problem && !choice && <Text>{t(problem)}</Text>}
        {session.status === 'unavailable' && <Text>{t('editor.unavailable')}</Text>}
        {session.status === 'protocol_mismatch' && <Text>{t('editor.update')}</Text>}
        {session.status === 'start_failed' && <><Text>{t('editor.startFailed')}</Text><Button label={t('editor.retryNow')} onPress={reopen} /></>}
        {session.engineStopped && <><Text>{t(session.dirty && session.localCopy === 'failed' ? 'editor.notKept' : 'editor.killed')}</Text><Button label={t('editor.reopen')} onPress={reopen} /></>}
        {(['offline', 'paused'].includes(session.status) || problem) && !choice && <View accessibilityLiveRegion="polite"><Button label={retryLabel} disabled={paused} onPress={() => { if (!project) void load(); else void save(true); }} /></View>}
        {choice && <Modal visible animationType="none" onRequestClose={guard.done}>
            <View style={{ padding: 20 }}><Text accessibilityRole="header">{t(choice === 'restore' ? 'editor.restore' : 'editor.conflict')}</Text>
                {problem && <Text>{t(problem)}</Text>}
                {choice === 'restore' ? <>
                    <Button label={t('editor.restore')} onPress={() => { choose(null); dispatch({ type: 'retry', now: Date.now() }); }} />
                    <Button label={t('editor.discard')} onPress={() => { void useSaved(); }} />
                </> : <>
                    <Button label={t('editor.useSaved')} disabled={copyBusy} onPress={confirmSaved} />
                    <Button label={paused ? retryLabel : t('editor.keepCopy')} disabled={copyBusy || paused} onPress={() => { void keepCopy(); }} />
                </>}
            </View>
        </Modal>}
    </View>;
}
