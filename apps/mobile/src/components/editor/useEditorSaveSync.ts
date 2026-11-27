import { documentProblem, type DocumentCommitResult } from '../../lib/editorDocumentGate';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Alert, AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSessionTask, isAccountChanged } from '../../auth/sessionTask';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { ApiError, type ApiClient } from '../../lib/api';
import { documentIdentity, validDocument, type ProjectDocument } from '../../lib/editorBridge';
import { readDraft, writeDraft, removeDraft, type EditorDraft } from '../../lib/editorDrafts';
import { cancelManualEditorCommit, createProject, conflictCopyName, finalizeManualEditorCommit, getDocument, getManualEditorCommitStatus, putDocument, putPaidDocument, quoteManualEditorCommit, editorErrorKey, type DocumentHead } from '../../lib/editorProjects';
import { ambiguous, refused, canStart, canRetry, owns, retryDelay, decideDraft, createDraftQueue, type Operation } from '../../lib/editorSaveSafety';
import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { restoreVersion, projectsErrorMessage } from '../../lib/projects';
import { isOffline } from '../../lib/networkState';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { projectCloudSyncEnabled } from '../../lib/projectSyncPreference';

type Ref<T> = MutableRefObject<T>;
type Options = {
    api: ApiClient; projectId: string; name: string;
    documentRef: Ref<ProjectDocument | null>; revisionRef: Ref<number>; dirtyRef: Ref<boolean>;
    baseline(head: DocumentHead): void; saved(doc: ProjectDocument): void; markDocument(doc: ProjectDocument, record?: boolean): DocumentCommitResult;
    mergeBackups(doc: ProjectDocument): ProjectDocument; problem: string | null; setProblem(message: string | null): void;
    onOwnerChange(): void; onCopy(id: string): void; clearDocument(): void; entryImport(): Promise<void>;
};
type Save = Operation & { key: string; expectedRevision: number; document: ProjectDocument; expectedCredits?: number; paidReplayAttempted?: boolean; reconcileChecks?: number };
export type PaidSaveResult = { committed: boolean; revision: number | null; credits: number | null };
type SaveOutcome = PaidSaveResult & { clean: boolean };
type Restore = Operation & { key: string; current: number; restore: number; identity: string };
type Copy = Operation & { createKey: string; saveKey: string; name: string; workspaceId: string; document: ProjectDocument; identity: string; id?: string };

export function useEditorSaveSync(options: Options) {
    const latest = useRef(options); latest.current = options;
    const beginSessionTask = useSessionTask();
    const sessionFactory = useRef(beginSessionTask); sessionFactory.current = beginSessionTask;
    const [, update] = useState(0);
    const [sync] = useState(() => {
        const owner = getCacheUser(), session = sessionFactory.current();
        let mounted = true, stopped = false, epoch = 0, watchGen = 0, imports = 0, localOnly = false;
        let saving: Operation | null = null, replacing: Operation | null = null;
        let pending: Save | null = null, paidReconcile: Save | null = null, paidDelivery: Save | null = null, restoreOp: Restore | null = null, copy: Copy | null = null;
        let remote: DocumentHead | null = null, recovery: EditorDraft | null = null;
        let sheet: 'conflict' | 'recovery' | 'versions' | null = null;
        let gate: 'loading' | 'pending' | 'open' = 'loading', workspaceId: string | null = null;
        let failure: number | null = null, failureCode: string | null = null, recovered = false, attempt = 0;
        let draftState = { identity: '', kept: 'pending' as 'pending' | 'kept' | 'failed' };
        let saveRun: Promise<SaveOutcome> | null = null;
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
            stopped = true; pending = null; paidReconcile = null; paidDelivery = null; restoreOp = null; copy = null; saving = replacing = null;
            failure = null; failureCode = null; sheet = null; remote = null;
            clear('auto', 'retry', 'draft', 'watch'); watchGen++; notify();
        }
        async function flushDraft() {
            clear('draft');
            const doc = o().documentRef.current;
            if (!live() || gate !== 'open' || !doc || !o().dirtyRef.current) return;
            const merged = o().mergeBackups(doc);
            const document = documentProblem(merged) === null ? merged : doc;
            const captured = epoch, id = identity();
            let kept = false;
            try { kept = await queue.write({ owner: owner || '', projectId: o().projectId, baseRevision: o().revisionRef.current, document, updatedAt: Date.now() }, () => live() && epoch === captured) === true; } catch { /* Storage failure is reflected in the leave prompt. */ }
            if (live() && captured === epoch && id === identity()) draftState = { identity: id, kept: kept ? 'kept' : 'failed' };
        }
        function changed() {
            if (!live()) return;
            draftState = { identity: identity(), kept: 'pending' };
            if (gate !== 'open') return;
            clear('draft', 'auto');
            timers.draft = setTimeout(() => void flushDraft(), 400);
            if (!sheet && !restoreOp && (failure === null || !refused(failure))) {
                clear('retry'); timers.auto = setTimeout(() => void runSave(), pending ? 0 : 900);
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
            if (documentIdentity(merged) === documentIdentity(current) || documentProblem(merged)) return false;
            return o().markDocument(merged, false).status === 'accepted';
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
            pending = null; paidReconcile = null; copy = null; failure = null; failureCode = null; recovered = false; remote = null; recovery = null;
            o().baseline(head);
            const baselineIdentity = identity(), captured = epoch;
            await queue.remove(() => live() && epoch === captured && identity() === baselineIdentity && !o().dirtyRef.current).catch(() => undefined);
            if (!holds(op)) return;
            gate = 'open'; sheet = null; replacing = null;
            const current = o().documentRef.current;
            if (current) {
                const merged = o().mergeBackups(current);
                if (documentIdentity(merged) !== identity()) {
                    if (!documentProblem(merged)) { o().markDocument(merged, false); await flushDraft(); }
                }
                else if (o().dirtyRef.current) changed();
            }
            if (live()) notify();
        }
        async function acknowledgeSave(op: Save, revision: number) {
            pending = null;
            if (paidReconcile === op) paidReconcile = null;
            failure = null; failureCode = null; attempt = 0; recovered = false;
            o().revisionRef.current = revision;
            o().saved(op.document);
            if (identity() === documentIdentity(op.document)) {
                o().dirtyRef.current = false;
                const captured = epoch;
                await queue.remove(() => live() && epoch === captured && identity() === documentIdentity(op.document) && !o().dirtyRef.current).catch(() => undefined);
                if (!holds(op)) return false;
            } else await flushDraft();
            return !o().dirtyRef.current;
        }
        async function reconcilePaid(op: Save): Promise<SaveOutcome> {
            try {
                const status = await getManualEditorCommitStatus(o().api, o().projectId, op.key);
                if (!live() || epoch !== op.epoch || paidReconcile !== op) return { committed: false, clean: false, revision: null, credits: null };
                if ((status.pending || status.committed) && status.revision !== null) {
                    if (status.pending) paidDelivery = op;
                    const clean = await acknowledgeSave(op, status.revision);
                    return { committed: true, clean, revision: status.revision, credits: op.expectedCredits ?? null };
                }
                // The status RPC waits on the paid-save advisory lock, so a
                // missing exact key is authoritative after all already-issued
                // same-key transactions have committed or rolled back.
                paidReconcile = null;
                return { committed: false, clean: false, revision: null, credits: null };
            } catch (error) {
                if (isAccountChanged(error)) { drop(); return { committed: false, clean: false, revision: null, credits: null }; }
                if (!live() || epoch !== op.epoch || paidReconcile !== op) return { committed: false, clean: false, revision: null, credits: null };
                const checks = op.reconcileChecks = (op.reconcileChecks ?? 0) + 1;
                if (checks < 6) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay(checks - 1, (error as ApiError).retryAfterSeconds)));
                    return reconcilePaid(op);
                }
                // Keep the exact paid operation and idempotency key available
                // for an explicit retry. Starting a fresh paid save here could
                // double-charge after an unreachable but successful commit.
                return { committed: false, clean: false, revision: null, credits: null };
            }
        }
        function runSave(expectedCredits?: number): Promise<SaveOutcome> {
            if (saveRun) {
                if (expectedCredits === undefined || (saving as Save | null)?.expectedCredits !== undefined) return saveRun;
                return saveRun.then(() => pending || imports > 0
                    ? { committed: false, clean: false, revision: null, credits: null }
                    : runSave(expectedCredits));
            }
            if (expectedCredits !== undefined && paidDelivery) {
                return Promise.resolve({ committed: false, clean: false, revision: null, credits: null });
            }
            if (expectedCredits !== undefined && paidReconcile) {
                const op = paidReconcile;
                if (op.expectedCredits !== expectedCredits || !canRetry(locks(), op))
                    return Promise.resolve({ committed: false, clean: false, revision: null, credits: null });
                op.token = {}; op.state = 'ambiguous'; op.reconcileChecks = 0;
                saving = op; watchGen++; notify();
                saveRun = (async () => {
                    try { return await reconcilePaid(op); }
                    finally {
                        if (saving === op) saving = null;
                        saveRun = null; watchGen++;
                        if (live()) notify();
                    }
                })();
                return saveRun;
            }
            if (expectedCredits !== undefined && pending) {
                if (!canRetry(locks(), pending)) return Promise.resolve({ committed: false, clean: false, revision: null, credits: null });
                return runSave().then(() => pending || imports > 0
                    ? { committed: false, clean: false, revision: null, credits: null }
                    : runSave(expectedCredits));
            }
            if (!live() || gate !== 'open' || sheet || restoreOp || (!pending && !canStart(locks())) || (pending && !canRetry(locks(), pending)))
                return Promise.resolve({ committed: false, clean: false, revision: null, credits: null });
            // Once this source set is covered, an explicit Save/Export must not
            // consume another document revision when nothing changed.
            if ((!o().dirtyRef.current && (expectedCredits === undefined || expectedCredits === 0)) || !o().documentRef.current)
                return Promise.resolve({ committed: expectedCredits !== undefined, clean: true, revision: o().revisionRef.current, credits: expectedCredits ?? null });
            if (failure !== null && refused(failure)) return Promise.resolve({ committed: false, clean: false, revision: null, credits: null });
            const op: Save = expectedCredits === undefined && pending
                ? pending : { ...start(), key: randomUUID(), expectedRevision: o().revisionRef.current, document: o().documentRef.current!, expectedCredits };
            op.token = {}; op.state = 'inflight';
            if (op.expectedCredits === undefined) pending = op;
            saving = op; watchGen++; clear('auto', 'retry'); notify();
            saveRun = (async () => {
                try {
                    await flushDraft();
                    if (!holds(op)) return { committed: false, clean: false, revision: null, credits: null };
                    if (localOnly) {
                        if (op.expectedCredits !== undefined) throw new ApiError(0, 'offline');
                        pending = null; failure = null; failureCode = null; attempt = 0; recovered = false;
                        o().saved(op.document);
                        if (identity() === documentIdentity(op.document)) o().dirtyRef.current = false;
                        else timers.auto = setTimeout(() => void runSave(), 0);
                        return { committed: false, clean: !o().dirtyRef.current, revision: o().revisionRef.current, credits: null };
                    }
                    if (!validDocument(op.document, o().projectId)) throw new ApiError(400, 'invalid_document');
                    let result;
                    if (op.expectedCredits === undefined) result = await putDocument(o().api, o().projectId, op.expectedRevision, op.document, op.key);
                    else try {
                        result = await putPaidDocument(o().api, o().projectId, op.expectedRevision, op.document, op.key, op.expectedCredits);
                    } catch (error) {
                        const status = (error as ApiError).status ?? 500;
                        if (!ambiguous(status) || op.paidReplayAttempted) throw error;
                        // One same-key replay remains part of this explicit
                        // action. The server serializes it and cannot debit it
                        // twice; no charge request is ever replayed by a timer.
                        op.paidReplayAttempted = true;
                        result = await putPaidDocument(o().api, o().projectId, op.expectedRevision, op.document, op.key, op.expectedCredits);
                    }
                    if (!holds(op)) return { committed: false, clean: false, revision: null, credits: null };
                    if (op.expectedCredits !== undefined) paidDelivery = op;
                    const clean = await acknowledgeSave(op, result.revision);
                    return { committed: op.expectedCredits !== undefined, clean, revision: result.revision, credits: op.expectedCredits ?? null };
                } catch (error) {
                    if (isAccountChanged(error)) { drop(); return { committed: false, clean: false, revision: null, credits: null }; }
                    if (!holds(op)) return { committed: false, clean: false, revision: null, credits: null };
                    const status = (error as ApiError).status ?? 500;
                    const code = error instanceof ApiError ? error.code.toLowerCase() : '';
                    failureCode = code || null;
                    if (op.expectedCredits !== undefined && ambiguous(status)) {
                        paidReconcile = op; op.state = 'ambiguous'; failure = null;
                        return await reconcilePaid(op);
                    }
                    if (op.expectedCredits !== undefined) {
                        // A paid action exists only while the person is explicitly
                        // saving/exporting. Never retry it in the background, and
                        // never let a declined or ambiguous charge stop the free
                        // autosave path. The next explicit action quotes afresh.
                        paidReconcile = null; failure = null;
                        if (status === 409 && code === 'version_conflict') await fetchConflict(op);
                    }
                    else if (ambiguous(status)) { failure = status; op.state = 'ambiguous'; retry(error, runSave); }
                    else if (refused(status)) {
                        failure = status;
                        pending = null;
                        if (status === 409) await fetchConflict(op);
                    }
                    // Any other definite refusal (413, 422, ...): the server kept nothing, so a later attempt saves afresh.
                    else { failure = status; pending = null; retry(error, runSave); }
                    return { committed: false, clean: false, revision: null, credits: null };
                } finally {
                    if (saving === op) saving = null;
                    saveRun = null; watchGen++;
                    if (live()) {
                        notify();
                        if (!pending && failure === null && o().dirtyRef.current && !sheet) timers.auto = setTimeout(() => void runSave(), 0);
                    }
                }
            })();
            return saveRun;
        }
        async function useSavedNow() {
            if (localOnly || !canStart(locks())) return;
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
        function copyDocument() {
            const current = o().documentRef.current!;
            const merged = o().mergeBackups(current);
            return documentProblem(current) === null && documentProblem(merged) !== null ? current : merged;
        }
        async function keepCopy() {
            if (copy ? !canRetry(locks(), copy) : !canStart(locks())) return;
            if (!o().documentRef.current || !workspaceId) return;
            copy ??= { ...start(), createKey: randomUUID(), saveKey: randomUUID(), name: conflictCopyName(o().name), workspaceId, document: copyDocument(), identity: identity() };
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
                if (documentIdentity(copyDocument()) === documentIdentity(op.document)) {
                    await queue.remove(() => holds(op) && identity() === op.identity && documentIdentity(copyDocument()) === documentIdentity(op.document)).catch(() => undefined);
                }
                if (!holds(op)) return;
                if (identity() !== op.identity) {
                    op.state = 'ambiguous'; await flushDraft();
                    if (holds(op)) o().setProblem(t('editorSave.copyChanged'));
                    return;
                }
                if (documentIdentity(copyDocument()) !== documentIdentity(op.document)) await flushDraft();
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
            if (localOnly) return;
            const allowed = () => canStart(locks()) && !o().dirtyRef.current && revision !== o().revisionRef.current;
            if (!allowed()) return;
            Alert.alert(t('projects.restoreversion', { value1: revision }), t('projects.thissavesanewversioncopiedfrom'), [
                { text: t('projects.cancel'), style: 'cancel' }, { text: t('projects.restore'), onPress: () => {
                    if (!allowed()) return;
                    restoreOp = { ...start(), state: 'ambiguous', key: randomUUID(), current: o().revisionRef.current, restore: revision, identity: identity() };
                    attempt = 0; void runRestore();
                } },
            ]);
        }
        async function watch() {
            if (localOnly) return;
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
                end() { if (!ended) { ended = true; imports--; if (live()) { notify(); if (!sheet && o().dirtyRef.current) timers.auto = setTimeout(() => void runSave(), 0); } } },
            };
        }
        async function loaded(head: DocumentHead, workspace: string | null) {
            if (!live()) return;
            workspaceId = workspace;
            const captured = epoch;
            let draft: EditorDraft | null = null, unreadable = false;
            try { draft = await readDraft(o().projectId); } catch { unreadable = true; }
            localOnly = !(await projectCloudSyncEnabled(o().projectId).catch(() => true));
            if (!live() || captured !== epoch) return;
            if (unreadable) {
                // Keep editing and saving; the unreadable draft is left in place until a new one replaces it.
                gate = 'open'; await o().entryImport();
                if (!live()) return;
                if (o().dirtyRef.current) changed();
                o().setProblem(t('editorSave.draftUnreadable')); notify(); return;
            }
            if (localOnly) {
                gate = 'open';
                if (draft) {
                    o().baseline({ document: draft.document, revision: draft.baseRevision });
                    o().markDocument(draft.document, false);
                }
                await o().entryImport();
                if (live() && o().dirtyRef.current) changed();
                if (live()) notify();
                return;
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
            if (o().dirtyRef.current && failure !== 429 && !isOffline()) await runSave();
            if (!live()) return false;
            if (!o().dirtyRef.current) return true;
            return new Promise<boolean>(resolve => Alert.alert(t(draftState.identity === identity() && draftState.kept === 'kept' ? 'editor.leaveKept' : 'editor.leaveLost'), undefined, [
                { text: t('editor.stay'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('editor.leave'), style: 'destructive', onPress: () => resolve(live()) },
            ], { cancelable: true, onDismiss: () => resolve(false) }));
        }
        return {
            live, changed, loaded, beginImport, flushDraft, save: () => runSave().then(result => result.clean),
            savePaid: (credits: number): Promise<PaidSaveResult> => runSave(credits).then(({ committed, revision, credits: charged }) => ({ committed, revision, credits: charged })),
            finalizePaid: async (): Promise<number | null> => {
                const op = paidDelivery;
                if (!live()) return null;
                if (!op) return o().revisionRef.current;
                const revision = await finalizeManualEditorCommit(o().api, o().projectId, op.key);
                if (paidDelivery === op) paidDelivery = null;
                return revision;
            },
            cancelPaid: async (): Promise<boolean> => {
                const op = paidDelivery;
                if (!live()) return false;
                if (!op) return true;
                await cancelManualEditorCommit(o().api, o().projectId, op.key);
                if (paidDelivery === op) paidDelivery = null;
                return true;
            },
            quotePaid: () => {
                const document = o().documentRef.current;
                if (!live() || gate !== 'open' || localOnly || imports > 0 || paidReconcile || !document) return Promise.reject(new ApiError(0, 'offline'));
                return quoteManualEditorCommit(o().api, o().projectId, o().revisionRef.current, document);
            },
            leaveEditor, restore, retryRestore: runRestore, accountChanged: drop,
            observeHead(head: DocumentHead) {
                if (live() && restoreOp?.state === 'ambiguous' && head.revision > restoreOp.current) { restoreOp = null; clear('retry'); conflict(head); }
            },
            get problem() { return o().problem; },
            get failureCode() { return failureCode; },
            useSaved: () => confirmDiscard(useSavedNow), recover: () => void recover(false), discard: () => confirmDiscard(() => recover(true), true), keepCopy,
            openVersions() { if (live() && !sheet) { sheet = 'versions'; clear('auto'); notify(); } },
            closeVersions() { if (sheet === 'versions') { sheet = null; notify(); if (!settle() && !restoreOp && o().dirtyRef.current) changed(); } },
            settle,
            get draftDecided() { return gate === 'open'; },
            get sheet() { return sheet; }, get replacing() { return !!replacing; }, get imports() { return imports; }, get epoch() { return epoch; },
            get canStart() { return canStart(locks()); }, get copyAllowed() { return !localOnly && !!workspaceId && (copy ? canRetry(locks(), copy) : canStart(locks())); },
            get restoreUnknown() { return restoreOp?.state === 'ambiguous'; }, get retryAllowed() { return !!restoreOp && canRetry(locks(), restoreOp); },
            get saving() { return !!saving; }, get dirty() { return o().dirtyRef.current; }, get revision() { return o().revisionRef.current; },
            get saveStatus() {
                return saving ? t('editor.saving') : restoreOp?.state === 'ambiguous' ? t('editorSave.restoreUnknown') : sheet === 'conflict' || remote ? t('editor.conflict') : failure !== null ? t(editorErrorKey(failure)) : o().dirtyRef.current ? t(recovered ? 'editorSave.recovered' : 'editor.unsavedchanges') : localOnly ? 'Saved on this iPhone' : t('editor.v2', { value1: t('editor.saved'), value2: o().revisionRef.current });
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
