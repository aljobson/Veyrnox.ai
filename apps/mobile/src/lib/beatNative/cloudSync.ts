import { TakeMediaError } from './takeMediaFailures';
import { createTakeCloud } from './takeCloud';
import { beforeReplace } from './recordingFinalizers';
import { normalizeCloudError } from './cloud';
import { ApiError, type ApiClient } from '../api';
import { createBeatCloud, type BeatCloud } from './cloud';
import { probeBeatCloud, type BeatProbe } from './probe';
import { conflictRequest, errorState, isRemoved, maySync, needsSync, parseCloudBeat, removedLink, retryDelay, saveRequest, takeAssets, type BeatRecord, type CloudLink, type SaveBody } from './rules';
import { newId, type BeatStore } from './store';
import type { BeatDoc } from './doc';
export type SyncState = 'checking' | 'off' | 'unlinked' | 'other' | 'signed_out' | 'syncing' | 'synced' | 'conflict' | 'paused_conflict' | 'removed' | 'limit' | 'rate_limited' | 'offline' | 'error' | 'takes';
export type Conflict = { doc: BeatDoc; cloud: CloudLink };
export type SyncView = { state: SyncState; busy: boolean; conflict: Conflict | null; detail: boolean };

export class BeatCloudSync {
    private view: SyncView = { state: 'checking', busy: false, conflict: null, detail: false };
    private listeners = new Set<() => void>();
    private abort = new AbortController();
    private userId: string | null = null;
    private generation = 0;
    private active = true;
    private availability: BeatProbe['state'] = 'error';
    private busy = false;
    private conflict: Conflict | null = null;
    private attempt = 0;
    private retryAt = 0;
    private mediaTimer?: ReturnType<typeof setTimeout>;
    private timer?: ReturnType<typeof setTimeout>;
    private pending?: { signature: string; key: string };
    private unsubscribe?: () => void;
    private opened = false;
    private halted = false;
    private mediaPending = new Set<string>();
    readonly takes: ReturnType<typeof createTakeCloud>;
    readonly cloud: BeatCloud;
    constructor(private api: ApiClient, readonly store: BeatStore, readonly id: string) {
        this.cloud = createBeatCloud(api);
        this.takes = createTakeCloud(api);
    }
    snapshot = () => this.view;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    private show(state: SyncState, detail = false) {
        this.view = { state, busy: this.busy, conflict: state === 'conflict' ? this.conflict : null, detail };
        this.listeners.forEach(l => l());
    }
    capture() {
        const generation = this.generation;
        const userId = this.userId;
        return { userId: userId ?? undefined, signal: this.abort.signal, current: () => this.active && generation === this.generation && userId === this.userId };
    }
    async start(userId: string | null) {
        this.active = true;
        this.unsubscribe ??= this.store.subscribeBeats(() => this.schedule());
        clearTimeout(this.mediaTimer); this.takes.reset(); this.mediaPending.clear();
        this.opened = false; this.halted = false; this.availability = 'error';
        this.generation++; this.abort.abort(); this.abort = new AbortController();
        this.userId = userId; this.busy = false; this.conflict = null; this.pending = undefined; this.retryAt = 0; this.attempt = 0;
        clearTimeout(this.timer);
        if (!userId) { this.availability = 'signed_out'; this.show('signed_out'); return; }
        this.show('checking');
        const token = this.capture();
        const result = await probeBeatCloud(this.api, token);
        if (!token.current()) return;
        this.availability = result.state;
        if (result.state !== 'on') { this.show(result.state); return; }
        await this.cycle();
    }
    dispose() { this.active = false; this.generation++; this.abort.abort(); clearTimeout(this.timer); clearTimeout(this.mediaTimer); this.unsubscribe?.(); this.unsubscribe = undefined; }
    private schedule(delay = 800) {
        if (this.halted || !this.active || this.availability !== 'on' || !this.userId || this.busy || this.conflict || ['limit', 'removed'].includes(this.view.state)) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.cycle(); }, Math.max(delay, this.retryAt - Date.now()));
    }
    private async write(record: BeatRecord, body: SaveBody, token: ReturnType<BeatCloudSync['capture']>, link = true) {
        if (!token.current()) throw new Error('account_changed');
        const signature = JSON.stringify(body);
        if (this.pending?.signature !== signature) this.pending = { signature, key: newId() };
        const result = await this.cloud.put(this.id, body, this.pending.key, token);
        if (!token.current()) throw new Error('account_changed');
        if (link && !this.store.setCloudLink(this.id, { userId: token.userId!, projectId: result.project.id, revision: result.project.revision, syncedUpdatedAt: record.doc.updatedAt })) throw new Error('local_conflict');
        if (link) { this.opened = true; await this.store.flushBeat(this.id); this.conflict = null; }
        return result;
    }
    private async syncMedia(doc: BeatDoc, token: ReturnType<BeatCloudSync['capture']>) {
        if (takeAssets(doc).length) this.mediaPending.add(doc.id);
        const downloaded = await this.takes.download(doc, token);
        const uploaded = await this.takes.upload(doc, token);
        const complete = downloaded && uploaded;
        if (complete) this.mediaPending.delete(doc.id);
        return complete;
    }
    private scheduleMedia() {
        clearTimeout(this.mediaTimer);
        const at = this.takes.nextRetryAt(this.id);
        if (at && this.active && !this.halted && !this.conflict && this.availability === 'on') {
            this.mediaTimer = setTimeout(() => { void this.cycle(); }, Math.max(1000, at - Date.now()));
        }
    }
    private normalizeFailure(error: unknown): ApiError {
        error = normalizeCloudError(error);
        return error instanceof ApiError ? error : new ApiError(500, 'LOCAL_ERROR');
    }
    private parseAccountDoc(json: string): BeatDoc {
        try { return parseCloudBeat(json, this.id); }
        catch { throw new ApiError(500, 'INVALID_BEAT'); }
    }
    private async failure(error: unknown, token: ReturnType<BeatCloudSync['capture']>) {
        if (!token.current()) return;
        if (error instanceof ApiError && /_unavailable$/i.test(error.code)) { this.availability = 'off'; this.show('off'); return; }
        error = this.normalizeFailure(error);
        const state = errorState(error);
        if (state === 'removed') {
            const probe = await probeBeatCloud(this.api, token);
            if (!token.current()) return;
            this.availability = probe.state;
            if (probe.state !== 'on') { this.show(probe.state); return; }
            this.store.setCloudLink(this.id, removedLink(token.userId!));
            await this.store.flushBeat(this.id);
            if (token.current()) { this.conflict = null; this.show('removed'); }
            return;
        }
        if (state === 'conflict') {
            try {
                const result = await this.cloud.get(this.id, token);
                if (!token.current()) return;
                const doc = this.parseAccountDoc(result.doc_json);
                this.conflict = { doc, cloud: { userId: token.userId!, projectId: result.project.id, revision: result.project.revision, syncedUpdatedAt: doc.updatedAt } };
                this.show('conflict');
            } catch (readError) {
                if (errorState(this.normalizeFailure(readError)) === 'removed') await this.failure(readError, token);
                else this.retryFailure(readError, token);
            }
            return;
        }
        this.retryFailure(error, token);
    }
    private retryFailure(error: unknown, token: ReturnType<BeatCloudSync['capture']>) {
        if (!token.current()) return;
        const normalized = this.normalizeFailure(error);
        this.show(errorState(normalized));
        if (normalized.code === 'INVALID_BEAT') {
            this.halted = true; this.opened = false; this.retryAt = 0; clearTimeout(this.timer); return;
        }
        const delay = retryDelay(this.attempt++, normalized);
        if (delay === null) { this.halted = true; this.retryAt = 0; clearTimeout(this.timer); return; }
        this.retryAt = Date.now() + Math.max(delay, error instanceof ApiError ? (error.retryAfterSeconds ?? 0) * 1000 : 0);
    }
    async cycle(mode: 'autosave' | 'checkpoint' = 'autosave', lifecycle = false): Promise<boolean> {
        if (this.halted || this.busy || this.conflict || !this.active || this.availability !== 'on' || !this.userId) return false;
        const current = this.store.getRecord(this.id);
        if (lifecycle && current && !needsSync(current, this.userId) && !this.mediaPending.has(this.id) && mode !== 'checkpoint') return false;
        if (!lifecycle && this.retryAt > Date.now()) { this.schedule(); return false; }
        clearTimeout(this.timer);
        const token = this.capture();
        this.busy = true;
        try {
            await this.store.flushBeat(this.id);
            if (!token.current()) return false;
            const record = this.store.getRecord(this.id);
            if (!record) return false;
            if (!maySync(record.cloud, this.userId)) {
                this.show(record.cloud?.userId === this.userId && isRemoved(record.cloud) ? 'removed' : record.cloud ? 'other' : 'unlinked'); return false;
            }
            const changed = needsSync(record, this.userId);
            if (!changed && !this.opened && !lifecycle && mode !== 'checkpoint') {
                const theirs = await this.cloud.get(this.id, token);
                if (!token.current()) return false;
                if (theirs.project.revision > record.cloud!.revision) {
                    const doc = this.parseAccountDoc(theirs.doc_json);
                    const replacement = { doc, cloud: { userId: this.userId, projectId: theirs.project.id, revision: theirs.project.revision, syncedUpdatedAt: doc.updatedAt } };
                    const latest = this.store.getRecord(this.id);
                    if (!latest) return false;
                    if (needsSync(latest, this.userId)) {
                        this.conflict = replacement; this.show('conflict'); return false;
                    }
                    const release = await beforeReplace(this.id);
                    try { await this.store.replaceFromCloud(this.id, replacement, {
                        isCurrent: token.current,
                        stash: async capturedDoc => {
                            // The barrier may wait for a pending file write before capturing the document.
                            if (capturedDoc.updatedAt !== record.doc.updatedAt) throw new Error('local_conflict');
                            await this.takes.upload(capturedDoc, token);
                        },
                    }); } finally { release(); }
                }
                this.opened = true;
            }
            if (mode === 'checkpoint' || changed) {
                this.show('syncing');
                await this.write(record, saveRequest(record.doc, record.cloud!.revision, mode), token);
            }
            if (!token.current()) return false;
            const latestDoc = this.store.getBeat(this.id)!;
            const complete = await this.syncMedia(latestDoc, token);
            this.attempt = 0; this.retryAt = 0; this.show(complete ? 'synced' : 'takes'); return complete;
        } catch (error) {
            try { await this.failure(error, token); } catch (failure) { this.retryFailure(failure, token); }
            return false;
        }
        finally {
            if (token.current()) {
                this.busy = false; this.show(this.view.state, this.view.detail); this.scheduleMedia();
                const latest = this.store.getRecord(this.id);
                if (latest && (needsSync(latest, this.userId!) || this.retryAt > Date.now())) this.schedule();
            }
        }
    }
    async link() {
        if (this.availability !== 'on' || !this.userId || this.busy) return false;
        const record = this.store.getRecord(this.id);
        if (!record || (record.cloud && !(record.cloud.userId === this.userId && isRemoved(record.cloud)))) return false;
        this.store.setCloudLink(this.id, { userId: this.userId, projectId: null, revision: 0, syncedUpdatedAt: 0 });
        this.show('unlinked'); this.retryAt = 0;
        return this.cycle();
    }
    async retry() {
        this.retryAt = 0; this.halted = false; this.takes.reset(); clearTimeout(this.mediaTimer);
        if (this.conflict) { this.show('conflict'); return; }
        if (this.availability !== 'on') { await this.start(this.userId); return; }
        await this.cycle();
    }
    async readFailed(error: unknown) {
        if (!(error instanceof ApiError) || (error.status !== 404 && !/_unavailable$/i.test(error.code))) return;
        const token = this.capture(), result = await probeBeatCloud(this.api, token);
        if (!token.current() || result.state === 'on') return;
        this.availability = result.state; this.show(result.state);
    }
    later() {
        if (!this.busy && this.conflict) { clearTimeout(this.timer); this.show('paused_conflict'); }
    }
    chooseVersion() { if (!this.busy && this.conflict) this.show('conflict'); }
    async resolve(choice: 'mine' | 'theirs') {
        if (this.busy || !this.conflict || !this.userId || this.availability !== 'on') return;
        const theirs = this.conflict, token = this.capture(); this.busy = true; this.show('conflict');
        try {
            if (choice === 'mine') {
                await this.store.flushBeat(this.id);
                const record = this.store.getRecord(this.id);
                if (!record || !token.current()) return;
                await this.write(record, conflictRequest(choice, record.doc, theirs.cloud.revision), token);
                await this.syncMedia(record.doc, token);
            } else {
                const release = await beforeReplace(this.id);
                try { await this.store.replaceFromCloud(this.id, theirs, { isCurrent: token.current, stash: async doc => {
                    await this.takes.upload(doc, token, true);
                    const record = this.store.getRecord(this.id)!;
                    await this.write({ ...record, doc }, conflictRequest(choice, doc, theirs.cloud.revision), token, false);
                } }); } finally { release(); }
                this.conflict = null; this.mediaPending.delete(this.id);
                await this.syncMedia(theirs.doc, token);
            }
            if (token.current()) { this.conflict = null; this.attempt = 0; this.retryAt = 0; this.show(this.mediaPending.has(this.id) ? 'takes' : 'synced'); }
        } catch (error) {
            if (!token.current()) return;
            if (error instanceof TakeMediaError) { this.show('conflict', true); return; }
            if (!this.conflict) { this.retryFailure(error, token); return; }
            if (['removed', 'conflict'].includes(errorState(this.normalizeFailure(error)))) {
                try { await this.failure(error, token); } catch { if (token.current()) this.show('conflict', true); }
            }
            else this.show('conflict', true);
        } finally { if (token.current()) { this.busy = false; this.show(this.view.state, this.view.detail); this.schedule(); this.scheduleMedia(); } }
    }
}
