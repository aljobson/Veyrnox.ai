import { isOffline } from '../networkState';
import { randomUUID } from 'expo-crypto';
import { errorKey, errorParams, failure, retireOnError, surfaceUnavailable } from './errors';
import { AI_TERMINAL, singleFlight } from './shared';
import type { BeatAiClient } from './client';
import type { MagicPending, Pending, Quote, Status } from './types';
export type Receipt = Pending | MagicPending;
export type View<R extends Receipt> = { rows: R[]; record: R | null; quote: Quote | null; open: boolean; busy: boolean; message: string; error: string; terminal: boolean; status?: Status; messages: string[]; errorParams?: Record<string, number>; pollRefused: boolean; retryAt: number };
export interface ReceiptStorage<R extends Receipt> {
    read(owner: string, beatId: string): Promise<R[]>;
    put(row: R, current?: () => boolean): Promise<void>;
    retire(row: R, current?: () => boolean): Promise<void>;
}
export interface RequestOptions<R extends Receipt> {
    owner: string; beatId: string; client: BeatAiClient; storage: ReceiptStorage<R>;
    current(): boolean; off(): void;
    finish(row: R, status: Status): Promise<{ keep?: R; message: string; messages?: string[] }>;
}
/** One instance belongs to exactly one owner, editor mount and auth generation. */
export class ReceiptRequest<R extends Receipt> {
    private view: View<R> = { rows: [], record: null, quote: null, open: false, busy: false, message: '', error: '', terminal: false, messages: [], pollRefused: false, retryAt: 0 };
    private listeners = new Set<() => void>();
    private gate = singleFlight();
    private fresh: R | null = null;
    private disposed = false;
    constructor(readonly options: RequestOptions<R>) {}
    current = () => !this.disposed && this.options.current();
    snapshot = () => this.view;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    dispose() { this.disposed = true; }
    private set(patch: Partial<View<R>>) { if (this.current()) { this.view = { ...this.view, ...patch }; this.listeners.forEach(l => l()); } }
    clearError = () => { if (this.view.error) this.set({ error: '', errorParams: undefined }); };
    private async refreshRows() { const rows = await this.options.storage.read(this.options.owner, this.options.beatId); if (this.current()) this.set({ rows }); }
    private run(work: () => Promise<void>) {
        return this.gate(async () => {
            if (!this.current()) return;
            this.set({ busy: true, error: '', errorParams: undefined });
            try { await work(); }
            catch (error) {
                if (!this.current()) return;
                this.set({ error: errorKey(error), errorParams: errorParams(error) });
                if (surfaceUnavailable(error)) this.options.off();
            } finally { this.set({ busy: false }); }
        });
    }
    initialize = () => this.run(() => this.refreshRows());
    open = () => { if (!this.view.busy) { this.fresh = null; this.set({ open: true, record: null, quote: null, error: '', message: '', terminal: false, status: undefined, messages: [], pollRefused: false, retryAt: 0 }); } };
    close = () => { if (!this.view.busy) this.set({ open: false }); };
    reset = () => { if (!this.view.busy && !this.view.record) { this.fresh = null; this.set({ quote: null, error: '', message: '' }); } };
    resume = (row: R) => this.run(async () => {
        if (row.owner !== this.options.owner || row.beatId !== this.options.beatId) return;
        const rows = await this.options.storage.read(row.owner, row.beatId);
        if (!this.current()) return;
        const stored = rows.find(r => r.key === row.key);
        if (!stored) return;
        this.fresh = null;
        const retryAt = this.view.record?.key === stored.key ? this.view.retryAt : 0;
        this.set({ record: stored, quote: { ...stored.quote, quote_id: stored.quoteId }, open: true, status: undefined, messages: [], pollRefused: false, retryAt, message: stored.requestId ? '' : 'beatAi.original', terminal: 'terminal' in stored && !!stored.terminal });
        // Resume NEVER posts. Accepted requests are checked using GET only.
        if (stored.requestId && !('terminal' in stored && stored.terminal)) await this.pollRow(stored);
    });
    price = (getQuote: () => Promise<Quote>, make: (quote: Quote, uuid: string) => R) => this.run(async () => {
        if (this.view.record || isOffline()) return;
        const quote = await getQuote();
        if (!this.current()) return;
        const row = make(quote, randomUUID());
        if (row.owner !== this.options.owner || row.beatId !== this.options.beatId) throw new Error('owner_mismatch');
        this.fresh = row;
        this.set({ quote, terminal: false, message: '' });
    });
    send = () => this.run(async () => {
        if (isOffline()) { this.set({ error: 'beatAi.offline' }); return; }
        const row = this.view.record ?? this.fresh;
        if (!row || !this.view.quote || !row.quote.affordable) return;
        if (row.requestId) { await this.pollRow(row); return; }
        await this.options.storage.put(row, this.current);
        if (!this.current()) return;
        this.set({ record: row, rows: [...this.view.rows.filter(r => r.key !== row.key), row] });
        // Do not replace this quote/key after a lost acknowledgement, even if a flag flips.
        let response;
        try { response = await this.options.client.submit({ ...row, submitPath: 'submitPath' in row ? row.submitPath : '/music/generations' }); }
        catch (error) {
            if (!this.current()) return;
            if (retireOnError(error)) await this.retire(row);
            if (!this.current()) return;
            throw error;
        }
        if (!this.current()) return;
        const accepted = { ...row, requestId: response.generation_id ?? response.request_id, ...('op' in row ? { state: 'accepted' as const } : {}) };
        await this.options.storage.put(accepted, this.current);
        if (!this.current()) return;
        this.set({ record: accepted, message: 'beatAi.waiting' });
        await this.refreshRows();
    });
    check = () => Date.now() < this.view.retryAt ? Promise.resolve() : this.run(async () => { if (this.view.record?.requestId) await this.pollRow(this.view.record); });
    private async pollRow(row: R) {
        if (Date.now() < this.view.retryAt) return;
        let status: Status;
        try { status = await this.options.client.poll({ op: 'op' in row ? row.op : 'generate', requestId: row.requestId }); }
        catch (error) {
            if (!this.current()) return;
            const e = failure(error);
            this.set({ pollRefused: retireOnError(error), retryAt: e.status === 429 ? Date.now() + (e.retryAfter || 60) * 1000 : 0 });
            throw error;
        }
        if (!this.current()) return;
        this.set({ status, pollRefused: false, retryAt: 0 });
        if (!AI_TERMINAL.has(status.state)) { this.set({ message: 'beatAi.waiting' }); return; }
        // Terminal status stops periodic polling, including a refused placement.
        this.set({ terminal: true });
        const outcome = await this.options.finish(row, status);
        if (!this.current()) return;
        this.set({ message: outcome.message, messages: outcome.messages ?? [] });
        if (outcome.keep) {
            await this.options.storage.put(outcome.keep, this.current);
            if (!this.current()) return;
            this.set({ record: outcome.keep });
            await this.refreshRows();
        } else await this.retire(row);
    }
    private async retire(row: R) {
        await this.options.storage.retire(row, this.current);
        if (!this.current()) return;
        this.fresh = null;
        this.set({ record: null, quote: null, status: undefined });
        await this.refreshRows();
    }
    discard = () => this.run(async () => { if (this.view.record) await this.retire(this.view.record); else this.reset(); });
}
