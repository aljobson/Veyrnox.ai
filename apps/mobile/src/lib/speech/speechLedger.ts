import * as Crypto from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import { DEFAULT_CINEMA } from '../cinemaCamera';
import { generationSignature, NO_JOB_REFUSALS, REFUNDED_REFUSALS, unknownGenerationOutcome, type ChargeSnapshot, type SubmitRequest } from '../generationSubmit';
import { mediaApi } from '../media';
import { rememberSubmitted, submittedRequests } from '../submittedRequests';

type Entry = { signature: string; delivered: boolean; key: string; state: 'open' | 'unknown' | 'accepted'; jobId?: string; recorded: boolean; batches: Set<string> };
// Entries are keyed by take key so an unfinished batch can retain an earlier job.
// The current index selects the latest take for requests outside that batch.
type Account = { entries: Map<string, Entry>; current: Map<string, string>; batches: Map<string, Map<string, string | null>>; lock: symbol | null; version: number };
export type SpeechFailure = { index: number; unknown: boolean };
const accounts = new Map<string, Account>();
let owner: string | undefined, epoch = 0, observing = false, revision = 0;
const listeners = new Set<() => void>();
const quoteInputs = new WeakMap<ChargeSnapshot, { unit: number; freeNow: number }>();
function publish(account: Account) {
    account.version = ++revision;
    if (accounts.get(owner ?? '') === account) listeners.forEach(listener => listener());
}

function clearAccounts() {
    epoch++;
    for (const account of accounts.values()) { account.entries.clear(); account.current.clear(); account.batches.clear(); account.lock = null; }
    accounts.clear();
    owner = getCacheUser();
    listeners.forEach(listener => listener());
}
function accountForOwner() {
    if (!observing) { observing = true; subscribeCacheUser(clearAccounts); }
    if (owner !== getCacheUser()) clearAccounts();
    const id = owner ?? '';
    let account = accounts.get(id);
    if (!account) { account = { entries: new Map(), current: new Map(), batches: new Map(), lock: null, version: ++revision }; accounts.set(id, account); }
    return account;
}
function itemRequest(request: SubmitRequest, index: number): SubmitRequest {
    const { inputsByIndex, ...base } = request;
    return { ...base, prompt: request.prompt.trim(), extraInputs: inputsByIndex?.[index] ?? request.extraInputs };
}
function fingerprints(request: SubmitRequest, count: number) {
    return Array.from({ length: count }, (_, index) => generationSignature(itemRequest(request, index), 1));
}
const batchIdentity = (signatures: string[]) => JSON.stringify([...new Set(signatures)].sort());
function newEntry(signature: string): Entry {
    return { signature, key: Crypto.randomUUID(), state: 'open', recorded: false, delivered: false, batches: new Set() };
}
function lookup(account: Account, signature: string, batch: string) {
    const held = account.batches.get(batch)?.get(signature);
    const accepted = held ? account.entries.get(held) : undefined;
    if (accepted?.state === 'accepted') return accepted;
    const key = account.current.get(signature);
    const entry = key ? account.entries.get(key) : undefined;
    return entry?.state === 'accepted' && entry.delivered ? undefined : entry;
}
function retainEntry(account: Account, entry: Entry) {
    account.entries.set(entry.key, entry);
    account.current.set(entry.signature, entry.key);
    // Attach replacements only to unresolved requirements. An earlier accepted
    // take belongs to its original batch even when this fingerprint gets a new take.
    for (const [id, members] of account.batches) {
        if (!members.has(entry.signature)) continue;
        const held = members.get(entry.signature);
        if (held && account.entries.get(held)?.state === 'accepted') continue;
        members.set(entry.signature, entry.key);
        entry.batches.add(id);
    }
}
function retainBatch(account: Account, signatures: string[], selected: (Entry | undefined)[]) {
    if (signatures.length < 2) return;
    const id = batchIdentity(signatures);
    const previous = account.batches.get(id);
    for (const key of previous?.values() ?? []) if (key) account.entries.get(key)?.batches.delete(id);
    const members = new Map<string, string | null>();
    signatures.forEach((signature, index) => {
        const selectedEntry = selected[index];
        const entry = selectedEntry && account.entries.has(selectedEntry.key) ? selectedEntry : undefined;
        members.set(signature, entry?.key ?? null);
        entry?.batches.add(id);
    });
    account.batches.set(id, members);
}
function closeBatch(account: Account, id: string) {
    const members = account.batches.get(id);
    account.batches.delete(id);
    for (const key of members?.values() ?? []) if (key) account.entries.get(key)?.batches.delete(id);
}
function removeEntry(account: Account, entry: Entry) {
    account.entries.delete(entry.key);
    if (account.current.get(entry.signature) === entry.key) account.current.delete(entry.signature);
}
function retireEntry(account: Account, entry: Entry) {
    if (entry.state === 'accepted') return;
    removeEntry(account, entry);
    for (const id of entry.batches) {
        const members = account.batches.get(id);
        if (members?.get(entry.signature) === entry.key) members.set(entry.signature, null);
    }
    entry.batches.clear();
}
function snapshot(account: Account, request: SubmitRequest, count: number, unit: number, freeNow: number): ChargeSnapshot {
    const signatures = fingerprints(request, count), batch = batchIdentity(signatures);
    const states = signatures.map(signature => lookup(account, signature, batch)?.state);
    let free = Math.max(0, Math.floor(freeNow));
    const ceilings = states.map(state => {
        if (state === 'accepted') return null;
        if (state === 'unknown') return unit;
        if (free > 0) { free--; return 0; }
        return unit;
    });
    const quote = { ceilings, total: ceilings.reduce<number>((sum, value) => sum + (value ?? 0), 0),
        payable: ceilings.reduce<number>((sum, value, index) => sum + (states[index] === 'unknown' ? 0 : value ?? 0), 0) };
    quoteInputs.set(quote, { unit, freeNow });
    return quote;
}

// Deliberately unbounded: evicting an entry could charge a voice again. In-memory only: app termination or an owner change loses unresolved keys. A retry
// after either event can charge again; persistence needs a separate account cache policy.
export function createSpeechSubmit() {
    return {
        // Only the active account is retained; subscriptions follow cache-user changes.
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        version() { return accountForOwner().version; },
        accepted(request: SubmitRequest, count: number) {
            const account = accountForOwner(), signatures = fingerprints(request, count);
            return signatures.flatMap((signature, index) => {
                const entry = lookup(account, signature, batchIdentity(signatures));
                return entry?.state === 'accepted' && entry.jobId ? [{ index, jobId: entry.jobId }] : [];
            });
        },
        hasUnknownOutcome(request: SubmitRequest, count: number) {
            const account = accountForOwner(), signatures = fingerprints(request, count);
            return signatures.some(signature => lookup(account, signature, batchIdentity(signatures))?.state === 'unknown');
        },
        // A reopened job is known to the person, so the next Generate outside its own batch is a new take.
        markDelivered(jobId: string) {
            const account = accountForOwner();
            for (const entry of [...account.entries.values()]) {
                if (entry.state !== 'accepted' || entry.jobId !== jobId) continue;
                entry.delivered = true;
                // A run in progress may still adopt this entry into its batch; it cleans up when it ends.
                if (entry.batches.size === 0 && !account.lock) removeEntry(account, entry);
                publish(account);
            }
        },
        hasUnresolvedEntries() {
            const account = accountForOwner();
            return [...account.entries.values()].some(entry => entry.state !== 'accepted')
                || [...account.batches.values()].some(members => [...members.values()].some(key => key === null));
        },
        snapshot(request: SubmitRequest, count: number, unit: number, freeNow: number): ChargeSnapshot {
            return snapshot(accountForOwner(), request, count, unit, freeNow);
        },
        async run(api: ApiClient, request: SubmitRequest, count = 1, onStarted?: (count: number) => void,
            onJob?: (jobId: string, index: number) => void, quote?: ChargeSnapshot, onFailed?: (failure: SpeechFailure) => void, attached: () => boolean = () => true) {
            const account = accountForOwner();
            if (account.lock) throw new ApiError(409, 'submission_in_progress');
            if (request.inputsByIndex && request.inputsByIndex.length !== count) throw new ApiError(400, 'invalid_inputs');
            const lock = Symbol(), version = epoch, runOwner = owner;
            account.lock = lock;
            const check = () => {
                if (owner !== getCacheUser()) clearAccounts();
                if (version !== epoch || runOwner !== getCacheUser()) throw new ApiError(409, 'submission_reset');
            };
            const record = async (entry: Entry, index: number) => {
                check();
                if (!entry.recorded && entry.jobId) {
                    try {
                        await rememberSubmitted(entry.jobId, itemRequest(request, index), { prompt: request.prompt }, {
                            opts: { aspect: null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' },
                            cameraOn: false, cinema: DEFAULT_CINEMA, characterOn: false, character: {},
                        });
                        check();
                        const saved = await submittedRequests.list();
                        check();
                        entry.recorded = saved.some(item => item.id === entry.jobId);
                        publish(account);
                    } catch { check(); } // Failed/skipped persistence must remain retryable.
                }
            };
            try {
                check();
                if (quote) {
                    const pricing = quoteInputs.get(quote) ?? { unit: request.confirmedCredits, freeNow: 0 };
                    if (pricing.unit === undefined) throw new ApiError(409, 'submission_reset');
                    const fresh = snapshot(account, request, count, pricing.unit, pricing.freeNow);
                    if (fresh.total !== quote.total || fresh.payable !== quote.payable
                        || JSON.stringify(fresh.ceilings) !== JSON.stringify(quote.ceilings)) throw new ApiError(409, 'submission_reset');
                }
                const signatures = fingerprints(request, count);
                const selected = signatures.map(signature => lookup(account, signature, batchIdentity(signatures)));
                const accepted = selected.map(entry => entry?.jobId ?? null);
                let started = accepted.filter(Boolean).length;
                onStarted?.(started);
                // Report every resumed item before the first POST, including later board indices.
                for (let index = 0; index < count; index++) {
                    check();
                    const entry = selected[index];
                    if (entry?.state === 'accepted') {
                        await record(entry, index);
                        check();
                        onJob?.(entry.jobId!, index);
                    }
                }
                for (let index = 0; index < count; index++) {
                    check();
                    if (accepted[index]) continue;
                    const signature = signatures[index];
                    let entry: Entry | undefined = selected[index] ?? newEntry(signature);
                    const attemptedEntry = entry;
                    const ceiling = quote?.ceilings[index];
                    if (quote && ceiling == null) throw new ApiError(409, 'submission_reset');
                    let result;
                    try {
                        result = await mediaApi(api).createGeneration({ ...itemRequest(request, index),
                            ...(quote ? { maxCharge: ceiling! } : {}), idempotencyKey: entry.key });
                    } catch (cause) {
                        check();
                        if (unknownGenerationOutcome(cause)) entry.state = 'unknown';
                        else if (cause instanceof ApiError && REFUNDED_REFUSALS.has(cause.code)) entry = undefined;
                        else if (cause instanceof ApiError && cause.code === 'price_changed') entry.state = 'open';
                        else if (entry.state !== 'unknown' && !(cause instanceof ApiError && NO_JOB_REFUSALS.has(cause.code))) entry = undefined;
                        selected[index] = entry;
                        if (entry) retainEntry(account, entry);
                        else retireEntry(account, attemptedEntry);
                        // Keep every unattempted voice as an open requirement of this batch.
                        for (let next = index + 1; next < count; next++) {
                            if (!selected[next]) {
                                selected[next] = newEntry(signatures[next]);
                                retainEntry(account, selected[next]!);
                            }
                        }
                        retainBatch(account, signatures, selected);
                        publish(account);
                        onFailed?.({ index, unknown: entry?.state === 'unknown' });
                        throw cause;
                    }
                    check();
                    entry.state = 'accepted'; entry.jobId = result.job_id;
                    selected[index] = entry;
                    retainEntry(account, entry);
                    publish(account);
                    accepted[index] = result.job_id;
                    await record(entry, index);
                    check();
                    onStarted?.(++started);
                    onJob?.(result.job_id, index);
                }
                check();
                if (attached()) {
                    for (const entry of selected) if (entry?.state === 'accepted') entry.delivered = true;
                    closeBatch(account, batchIdentity(signatures));
                    for (const entry of account.entries.values()) {
                        if (entry.delivered && entry.batches.size === 0) removeEntry(account, entry);
                    }
                } else {
                    // Reopening this exact board must also recover any previously delivered
                    // voices held by it, so retain its accepted selections until attached delivery.
                    retainBatch(account, signatures, selected);
                }
                publish(account);
                return accepted[0];
            } finally {
                if (version === epoch && account.lock === lock) { account.lock = null; publish(account); }
            }
        },
    };
}
