import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Alert, AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSessionTask, isAccountChanged } from '../../auth/sessionTask';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { ApiError, type ApiClient } from '../../lib/api';
import { documentIdentity, validDocument, type ProjectDocument } from '../../lib/editorBridge';
import { readDraft, writeDraft, removeDraft, type EditorDraft } from '../../lib/editorDrafts';
import { createProject, conflictCopyName, getDocument, putDocument, editorErrorKey, type DocumentHead } from '../../lib/editorProjects';
import { ambiguous, refused, canStart, canRetry, owns, retryDelay, decideDraft, createDraftQueue, type Operation } from '../../lib/editorSaveSafety';
import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { restoreVersion, projectsErrorMessage } from '../../lib/projects';
import { isOffline } from '../../lib/networkState';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';

type Ref<T> = MutableRefObject<T>;
type Options = {
    api: ApiClient; projectId: string; name: string;
    documentRef: Ref<ProjectDocument | null>; revisionRef: Ref<number>; dirtyRef: Ref<boolean>;
    baseline(head: DocumentHead): void; markDocument(doc: ProjectDocument, record?: boolean): void;
    mergeBackups(doc: ProjectDocument): ProjectDocument; problem: string | null; setProblem(message: string | null): void;
    onOwnerChange(): void; onCopy(id: string): void; clearDocument(): void; entryImport(): Promise<void>;
};
type Save = Operation & { key: string; expectedRevision: number; document: ProjectDocument };
type Restore = Operation & { key: string; current: number; restore: number; identity: string };
type Copy = Operation & { createKey: string; saveKey: string; name: string; workspaceId: string; document: ProjectDocument; identity: string; id?: string };

export function useEditorSaveSync(options: Options) {
    const latest = useRef(options); latest.current = options;
    const beginSessionTask = useSessionTask();
    const sessionFactory = useRef(beginSessionTask); sessionFactory.current = beginSessionTask;
    const [, update] = useState(0);
    const [sync] = useState(() => {
        const owner = getCacheUser(), session = sessionFactory.current();
        let mounted = true, stopped = false, epoch = 0, watchGen = 0, imports = 0;
        let saving: Operation | null = null, replacing: Operation | null = null;
        let pending: Save | null = null, restoreOp: Restore | null = null, copy: Copy | null = null;
        let remote: DocumentHead | null = null, recovery: EditorDraft | null = null;
        let sheet: 'conflict' | 'recovery' | 'versions' | null = null;
        let gate: 'loading' | 'pending' | 'open' = 'loading', workspaceId: string | null = null;
        let failure: number | null = null, recovered = false, attempt = 0;
        let draftState = { identity: '', kept: 'pending' as 'pending' | 'kept' | 'failed' };
        let saveRun: Promise<boolean> | null = null;
        const timers: Partial<Record<'auto' | 'retry' | 'draft' | 'watch', ReturnType<typeof setTimeout>>> = {};
        const o = () => latest.current;
        const live = () => mounted && !stopped && owner === getCacheUser() && session.current();
        const notify = () => { if (mounted) update(n => n + 1); };
        const identity = () => documentIdentity(o().documentRef.current);
        const locks = () => ({ live: live(), epoch, imports, saving, pending, restore: restoreOp, replacing });
        const start = () => ({ token: {}, epoch, state: 'inflight' as const });
        const holds = (op: Operation) => owns(locks(), op);
        const clear = (...names: (keyof typeof timers)[]) => names.forEach(name => { clearTimeout(timers[name]); delete timers[name]; });
        const queue = createDraftQueue({ write: writeDraft, remove: () => removeDraft(o().projectId) });
        function drop() {
            stopped = true; pending = null; restoreOp = null; copy = null; saving = replacing = null;
            failure = null; sheet = null; remote = null;
            clear('auto', 'retry', 'draft', 'watch'); watchGen++; notify();
        }
        async function flushDraft() {
            clear('draft');
            const doc = o().documentRef.current;
            if (!live() || gate !== 'open' || !doc || !o().dirtyRef.current) return;
            const captured = epoch, id = identity();
            let kept = false;
            try { kept = await queue.write({ owner: owner || '', projectId: o().projectId, baseRevision: o().revisionRef.current, document: o().mergeBackups(doc), updatedAt: Date.now() }, () => live() && epoch === captured) === true; } catch { /* Storage failure is reflected in the leave prompt. */ }
            if (live() && captured === epoch && id === identity()) draftState = { identity: id, kept: kept ? 'kept' : 'failed' };
        }
        function changed() {
            if (!live()) return;
            draftState = { identity: identity(), kept: 'pending' };
            if (gate !== 'open') return;
            clear('draft', 'auto');
            timers.draft = setTimeout(() => void flushDraft(), 400);
            if (!sheet && !restoreOp && (failure === null || !refused(failure))) {
                clear('retry'); timers.auto = setTimeout(() => void save(), pending ? 0 : 900);
            }
        }
        function retry(error: unknown, run: () => Promise<unknown>) {
            clear('retry');
            const invoke = () => {
                if (!live()) return;
                const retained = restoreOp ?? pending;
                if (retained && !canRetry(locks(), retained)) { timers.retry = setTimeout(invoke, 1000); return; }
                void run();
            };
            timers.retry = setTimeout(invoke, retryDelay(attempt++, (error as ApiError).retryAfterSeconds));
        }
        function conflict(head: DocumentHead) {
            remote = head; sheet = 'conflict'; clear('auto'); notify();
        }
        // Backups that landed while a sheet or replacement lock held them back are applied once it ends (R12).
        function settle() {
            const current = o().documentRef.current;
            if (!live() || sheet || replacing || restoreOp || gate !== 'open' || !current) return false;
            const merged = o().mergeBackups(current);
            if (documentIdentity(merged) === documentIdentity(current)) return false;
            o().markDocument(merged, false); return true;
        }
        async function fetchConflict(op: Operation) {
            if (!holds(op)) return;
            sheet = 'conflict'; notify();
            try { const head = await getDocument(o().api, o().projectId); if (holds(op)) conflict(head); }
            catch (error) { if (isAccountChanged(error)) drop(); }
        }
        async function adopt(head: DocumentHead, op: Operation, expected: string) {
            if (!holds(op)) return;
            if (identity() !== expected) { conflict(head); return; }
            clear('auto', 'retry', 'draft'); watchGen++; epoch++; op.epoch = epoch;
            pending = null; copy = null; failure = null; recovered = false; remote = null; recovery = null;
            o().baseline(head);
            const baselineIdentity = identity(), captured = epoch;
            await queue.remove(() => live() && epoch === captured && identity() === baselineIdentity && !o().dirtyRef.current).catch(() => undefined);
            if (!holds(op)) return;
            gate = 'open'; sheet = null; replacing = null;
            const current = o().documentRef.current;
            if (current) {
                const merged = o().mergeBackups(current);
                if (documentIdentity(merged) !== identity()) { o().markDocument(merged, false); await flushDraft(); }
                else if (o().dirtyRef.current) changed();
            }
            if (live()) notify();
        }
        function save(): Promise<boolean> {
            if (saveRun) return saveRun;
            if (!live() || gate !== 'open' || sheet || restoreOp || (!pending && !canStart(locks())) || (pending && !canRetry(locks(), pending))) return Promise.resolve(false);
            if (!o().dirtyRef.current || !o().documentRef.current) return Promise.resolve(true);
            if (failure !== null && refused(failure)) return Promise.resolve(false);
            const op: Save = pending ?? { ...start(), key: randomUUID(), expectedRevision: o().revisionRef.current, document: o().documentRef.current! };
            op.token = {}; op.state = 'inflight'; pending = op; saving = op; watchGen++; clear('auto', 'retry'); notify();
            saveRun = (async () => {
                try {
                    await flushDraft();
                    if (!holds(op)) return false;
                    if (!validDocument(op.document, o().projectId)) throw new ApiError(400, 'invalid_document');
                    const result = await putDocument(o().api, o().projectId, op.expectedRevision, op.document, op.key);
                    if (!holds(op)) return false;
                    pending = null; failure = null; attempt = 0; recovered = false;
                    // A later edit derives from this saved snapshot, so its base advances too.
                    o().revisionRef.current = result.revision;
                    if (identity() === documentIdentity(op.document)) {
                        o().dirtyRef.current = false;
                        const captured = epoch;
                        await queue.remove(() => live() && epoch === captured && identity() === documentIdentity(op.document) && !o().dirtyRef.current).catch(() => undefined);
                        if (!holds(op)) return false;
                    } else await flushDraft();
                    return !o().dirtyRef.current;
                } catch (error) {
                    if (isAccountChanged(error)) { drop(); return false; }
                    if (!holds(op)) return false;
                    const status = (error as ApiError).status ?? 500; failure = status;
                    if (ambiguous(status)) { op.state = 'ambiguous'; retry(error, save); }
                    else if (refused(status)) { pending = null; if (status === 409) await fetchConflict(op); }
                    // Any other definite refusal (413, 422, ...): the server kept nothing, so a later attempt saves afresh.
                    else { pending = null; retry(error, save); }
                    return false;
                } finally {
                    if (saving === op) saving = null;
                    saveRun = null; watchGen++;
                    if (live()) {
                        notify();
                        if (!pending && failure === null && o().dirtyRef.current && !sheet) timers.auto = setTimeout(() => void save(), 0);
                    }
                }
            })();
            return saveRun;
        }
        async function useSavedNow() {
            if (!canStart(locks())) return;
            const op = start(), agreed = identity(); replacing = op; watchGen++; notify();
            try {
                const head = await getDocument(o().api, o().projectId);
                if (holds(op)) await adopt(head, op, agreed);
            } catch (error) { if (isAccountChanged(error)) drop(); else if (holds(op)) o().setProblem(t(editorErrorKey((error as ApiError).status))); }
            finally { if (replacing === op) { replacing = null; settle(); } watchGen++; if (live()) notify(); }
        }
        function confirmDiscard(run: () => Promise<void>, always = false) {
            if (!canStart(locks())) return;
            if (always || o().dirtyRef.current) Alert.alert(t('editor.confirmDiscard'), undefined, [
                { text: t('editor.stay'), style: 'cancel' }, { text: t('editor.discard'), style: 'destructive', onPress: () => void run() },
            ]); else void run();
        }
        async function recover(discard: boolean) {
            if (!recovery || !canStart(locks())) return;
            const draft = recovery, op = start(), agreed = identity(); replacing = op; watchGen++; notify();
            if (discard) {
                try {
                    const head = await getDocument(o().api, o().projectId);
                    if (holds(op)) await adopt(head, op, agreed);
                    if (live() && !sheet) await o().entryImport();
                } catch (error) { if (isAccountChanged(error)) drop(); else if (holds(op)) o().setProblem(t(editorErrorKey((error as ApiError).status))); }
            } else {
                // The stored draft is never removed here: the rewrite replaces it, so a kill at any point keeps one copy.
                clear('draft'); epoch++; op.epoch = epoch;
                o().baseline({ revision: draft.baseRevision, document: draft.document });
                recovery = null; sheet = null; gate = 'open'; replacing = null; recovered = true;
                o().markDocument(draft.document, false);
                await flushDraft();
            }
            if (replacing === op) { replacing = null; settle(); } watchGen++; if (live()) notify();
        }
        async function keepCopy() {
            if (copy ? !canRetry(locks(), copy) : !canStart(locks())) return;
            if (!o().documentRef.current || !workspaceId) return;
            copy ??= { ...start(), createKey: randomUUID(), saveKey: randomUUID(), name: conflictCopyName(o().name), workspaceId, document: o().mergeBackups(o().documentRef.current!), identity: identity() };
            const op = copy; op.token = {}; op.state = 'inflight'; replacing = op; watchGen++; notify();
            try {
                if (!validDocument(op.document, o().projectId)) throw new ApiError(400, 'invalid_document');
                if (!op.id) {
                    const created = await createProject(o().api, op.workspaceId, op.name, op.createKey);
                    if (!holds(op)) return; op.id = created.id;
                }
                const copied = { ...op.document, project_id: op.id };
                if (!validDocument(copied, op.id)) throw new ApiError(400, 'invalid_document');
                await putDocument(o().api, op.id, 0, copied, op.saveKey);
                if (!holds(op)) return;
                const files = await editorDeviceMedia.files(o().projectId).catch(() => ({}));
                if (!holds(op)) return;
                const media = (op.document.timeline as { media?: Record<string, unknown> } | undefined)?.media ?? {};
                for (const [id, file] of Object.entries(files)) {
                    if (!holds(op)) return;
                    if (id.startsWith('l-') && media[id]) await editorDeviceMedia.copy(op.id, id, file.file, file.type, file.seconds).catch(() => null);
                }
                if (!holds(op)) return;
                if (identity() !== op.identity) { op.state = 'ambiguous'; await flushDraft(); if (holds(op)) o().setProblem(t('editorSave.copyChanged')); return; }
                clear('draft'); epoch++; op.epoch = epoch;
                if (documentIdentity(o().mergeBackups(o().documentRef.current!)) === documentIdentity(op.document)) {
                    await queue.remove(() => holds(op) && identity() === op.identity && documentIdentity(o().mergeBackups(o().documentRef.current!)) === documentIdentity(op.document)).catch(() => undefined);
                }
                if (!holds(op)) return;
                if (identity() !== op.identity) {
                    op.state = 'ambiguous'; await flushDraft();
                    if (holds(op)) o().setProblem(t('editorSave.copyChanged'));
                    return;
                }
                if (documentIdentity(o().mergeBackups(o().documentRef.current!)) !== documentIdentity(op.document)) await flushDraft();
                if (!holds(op)) return;
                if (identity() !== op.identity) {
                    op.state = 'ambiguous'; await flushDraft();
                    if (holds(op)) o().setProblem(t('editorSave.copyChanged'));
                    return;
                }
                o().onCopy(op.id);
            } catch (error) {
                if (isAccountChanged(error)) drop();
                else if (holds(op)) { op.state = 'ambiguous'; o().setProblem(t(editorErrorKey((error as ApiError).status))); }
            } finally { if (replacing === op) { replacing = null; settle(); } watchGen++; if (live()) notify(); }
        }
        async function runRestore() {
            const op = restoreOp;
            if (!op || !canRetry(locks(), op)) return;
            op.token = {}; op.state = 'inflight'; replacing = op; clear('retry'); watchGen++; notify();
            try {
                const raw = await restoreVersion(o().api, o().projectId, op.current, op.restore, op.key) as DocumentHead;
                if (!holds(op)) return;
                if (!Number.isSafeInteger(raw?.revision) || raw.revision <= op.current || !validDocument(raw.document, o().projectId)) {
                    op.state = 'ambiguous';
                    try {
                        const head = await getDocument(o().api, o().projectId);
                        if (!holds(op)) return;
                        if (head.revision > op.current && validDocument(head.document, o().projectId)) { restoreOp = null; attempt = 0; await adopt(head, op, op.identity); return; }
                    } catch (error) { if (isAccountChanged(error)) { drop(); return; } }
                    if (holds(op) && restoreOp === op) retry(new ApiError(503, 'invalid_response'), runRestore);
                    return;
                }
                restoreOp = null; attempt = 0;
                await adopt(raw, op, op.identity);
            } catch (error) {
                if (isAccountChanged(error)) { drop(); return; }
                if (!holds(op)) return;
                const status = (error as ApiError).status ?? 503;
                if (ambiguous(status)) { op.state = 'ambiguous'; retry(error, runRestore); }
                else { restoreOp = null; if (status === 409) await fetchConflict(op); else o().setProblem(projectsErrorMessage(error)); }
            } finally { if (replacing === op) { replacing = null; settle(); } watchGen++; if (live()) notify(); }
        }
        function restore(revision: number) {
            const allowed = () => canStart(locks()) && !o().dirtyRef.current && revision !== o().revisionRef.current;
            if (!allowed()) return;
            Alert.alert(t('projects.restoreversion'), t('projects.thissavesanewversioncopiedfrom'), [
                { text: t('projects.cancel'), style: 'cancel' }, { text: t('projects.restore'), onPress: () => {
                    if (!allowed()) return;
                    restoreOp = { ...start(), state: 'ambiguous', key: randomUUID(), current: o().revisionRef.current, restore: revision, identity: identity() };
                    attempt = 0; void runRestore();
                } },
            ]);
        }
        async function watch() {
            const allowed = () => live() && gate === 'open' && AppState.currentState === 'active' && !saving && !pending && !replacing && !sheet && (!restoreOp || restoreOp.state === 'ambiguous');
            if (!allowed()) return;
            const gen = watchGen, captured = epoch;
            try {
                const head = await getDocument(o().api, o().projectId);
                if (!allowed() || gen !== watchGen || captured !== epoch) return;
                if (restoreOp) {
                    if (head.revision <= restoreOp.current) return;
                    restoreOp = null; clear('retry');
                }
                if (head.revision > o().revisionRef.current) conflict(head);
            } catch (error) { if (isAccountChanged(error)) drop(); }
        }
        function beginImport() {
            if (!live() || replacing || gate !== 'open') return null;
            const captured = epoch, session = sessionFactory.current(); imports++; notify(); let ended = false;
            return {
                valid() {
                    if (!live()) return false;
                    if (!session.current()) { drop(); return false; }
                    if (captured !== epoch) { o().setProblem(t('editorSave.importDropped')); return false; }
                    return true;
                },
                end() { if (!ended) { ended = true; imports--; if (live()) { notify(); if (!sheet && o().dirtyRef.current) timers.auto = setTimeout(() => void save(), 0); } } },
            };
        }
        async function loaded(head: DocumentHead, workspace: string | null) {
            if (!live()) return;
            workspaceId = workspace;
            const captured = epoch;
            let draft: EditorDraft | null = null, unreadable = false;
            try { draft = await readDraft(o().projectId); } catch { unreadable = true; }
            if (!live() || captured !== epoch) return;
            if (unreadable) {
                // Keep editing and saving; the unreadable draft is left in place until a new one replaces it.
                gate = 'open'; await o().entryImport();
                if (!live()) return;
                if (o().dirtyRef.current) changed();
                o().setProblem(t('editorSave.draftUnreadable')); notify(); return;
            }
            const decision = decideDraft(draft, head);
            if (decision === 'none') {
                if (draft) await queue.remove(() => live() && captured === epoch).catch(() => undefined);
                if (!live() || captured !== epoch) return;
                gate = 'open'; await o().entryImport();
                if (live() && o().dirtyRef.current) changed();
            } else if (decision === 'recover') { recovery = draft; gate = 'pending'; sheet = 'recovery'; }
            else if (draft) { gate = 'open'; o().baseline({ document: draft.document, revision: draft.baseRevision }); conflict(head); o().markDocument(draft.document, false); }
            if (live()) notify();
        }
        async function leaveEditor() {
            if (!live()) return false;
            if (gate !== 'open') return true;
            await flushDraft(); if (!live()) return false;
            if (saveRun) await saveRun;
            if (!live()) return false;
            if (o().dirtyRef.current && failure !== 429 && !isOffline()) await save();
            if (!live()) return false;
            if (!o().dirtyRef.current) return true;
            return new Promise<boolean>(resolve => Alert.alert(t(draftState.identity === identity() && draftState.kept === 'kept' ? 'editor.leaveKept' : 'editor.leaveLost'), undefined, [
                { text: t('editor.stay'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('editor.leave'), style: 'destructive', onPress: () => resolve(live()) },
            ], { cancelable: true, onDismiss: () => resolve(false) }));
        }
        return {
            live, changed, loaded, beginImport, flushDraft, save, leaveEditor, restore, retryRestore: runRestore, accountChanged: drop,
            observeHead(head: DocumentHead) {
                if (live() && restoreOp?.state === 'ambiguous' && head.revision > restoreOp.current) { restoreOp = null; clear('retry'); conflict(head); }
            },
            get problem() { return o().problem; },
            useSaved: () => confirmDiscard(useSavedNow), recover: () => void recover(false), discard: () => confirmDiscard(() => recover(true), true), keepCopy,
            openVersions() { if (live() && !sheet) { sheet = 'versions'; clear('auto'); notify(); } },
            closeVersions() { if (sheet === 'versions') { sheet = null; notify(); if (!settle() && !restoreOp && o().dirtyRef.current) changed(); } },
            settle,
            get sheet() { return sheet; }, get replacing() { return !!replacing; }, get imports() { return imports; },
            get canStart() { return canStart(locks()); }, get copyAllowed() { return !!workspaceId && (copy ? canRetry(locks(), copy) : canStart(locks())); },
            get restoreUnknown() { return restoreOp?.state === 'ambiguous'; }, get retryAllowed() { return !!restoreOp && canRetry(locks(), restoreOp); },
            get saving() { return !!saving; }, get dirty() { return o().dirtyRef.current; }, get revision() { return o().revisionRef.current; },
            get saveStatus() {
                return saving ? t('editor.saving') : restoreOp?.state === 'ambiguous' ? t('editorSave.restoreUnknown') : sheet === 'conflict' || remote ? t('editor.conflict') : failure !== null ? t(editorErrorKey(failure)) : o().dirtyRef.current ? t(recovered ? 'editorSave.recovered' : 'editor.unsavedchanges') : t('editor.v2', { value1: t('editor.saved'), value2: o().revisionRef.current });
            },
            get retryVisible() { return failure !== null && !refused(failure) && !sheet; },
            attach() {
                mounted = true; stopped = false;
                const unsubscribe = subscribeCacheUser(() => {
                    if (owner === getCacheUser()) return;
                    epoch++; drop(); o().clearDocument(); o().onOwnerChange();
                });
                timers.watch = setInterval(() => void watch(), 15000);
                const app = AppState.addEventListener('change', state => {
                    if (state === 'background' && gate === 'open') void flushDraft();
                    if (state === 'active') void watch();
                });
                return () => { mounted = false; epoch++; drop(); unsubscribe(); app.remove(); };
            },
        };
    });
    useEffect(() => sync.attach(), [sync]);
    useAnnouncement(sync.saveStatus);
    return sync;
}
export type EditorSaveSync = ReturnType<typeof useEditorSaveSync>;
