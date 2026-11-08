import { ApiError, type ApiClient } from './api';
import { getCacheUser } from './appCache';
import { aiConsent } from './aiConsentStore';
import { bestCutSpeechGate } from './bestCutSpeechGate';
import { pollSpeech, recoverSpeech, forgetSpeechKey, speechKeyFor, startSpeech, SPEECH_PATH, type SpeechQuote, type SpeechOutcome } from './speechAnalysis';
import { uploadSource, putFromDisk } from './uploads';
import type { Media } from './nativeEditorModel';
import type { DeviceFile } from './editorDeviceMedia';
import type { BestCutInput } from './bestCutPlan';
export type BestCutSource = { type: 'job'; jobId: string } | { type: 'upload'; key: string };
export type BestCutClip = { media: Media; duration: number; file?: DeviceFile; source?: BestCutSource };
export type BestCutPhase = 'ready' | 'uploading' | 'preflight' | 'transcribing' | 'no-speech' | 'complete';
export type BestCutPrice = { cached: boolean; credits: number };
export type BestCutProgress = { phase: BestCutPhase; index: number; fraction: number; refunded: number; prices?: BestCutPrice[] };
export function bestCutPrice(quote: SpeechQuote, count: number, balance: number, prices?: BestCutPrice[]) {
    const total = prices ? prices.reduce((n, p) => n + p.credits, 0) : quote.credits * count;
    return { total, remaining: balance - total, maximum: !prices };
}
/** One instance per sheet/account. Keeps localMediaId -> upload -> receipt -> analysis across retries. */
export function createBestCutFlow(api: ApiClient, account: string, makeKey: () => string) {
    const identities = new Map<string, { source: BestCutSource; key?: string; outcome?: SpeechOutcome; paid?: number }>();
    const refunds = new Map<string, number>();
    const live = (signal: AbortSignal) => { if (signal.aborted || getCacheUser() !== account) throw new ApiError(0, 'cancelled'); };
    async function run(clips: BestCutClip[], quote: SpeechQuote, signal: AbortSignal, report: (value: BestCutProgress) => void): Promise<{ inputs: BestCutInput[]; silent: string[]; refunded: number }> {
        if (!clips.length || clips.length > 10 || clips.some(c => c.duration < .5 || c.duration > 60)) throw new ApiError(400, 'source_too_long');
        live(signal); await aiConsent.ensure(SPEECH_PATH, 'POST'); live(signal);
        const notify = (phase: BestCutPhase, index = 0, fraction = 0, prices?: BestCutPrice[]) => report({ phase, index, fraction, prices, refunded: [...refunds.values()].reduce((a, b) => a + b, 0) });
        for (const [index, clip] of clips.entries()) {
            live(signal); if (identities.has(clip.media.id)) continue;
            let source = clip.source;
            if (!source) {
                if (!clip.file) throw new ApiError(400, 'source_unsupported');
                // The default gate never claims local speech recognition happened.
                await bestCutSpeechGate().check(clip.file.file); live(signal);
                notify('uploading', index);
                const key = await uploadSource(api, { uri: clip.file.file, size: clip.file.size }, clip.file.type, f => notify('uploading', index, f), signal, putFromDisk);
                live(signal); source = { type: 'upload', key };
            }
            identities.set(clip.media.id, { source });
        }
        notify('preflight');
        const prices: BestCutPrice[] = [];
        for (const [index, clip] of clips.entries()) {
            const identity = identities.get(clip.media.id)!;
            if (identity.key) {
                try {
                    let recovered = await recoverSpeech(api, identity.key, account, signal);
                    if (recovered.status === 'queued') recovered = await pollSpeech(api, identity.key, account, signal, () => notify('transcribing', index));
                    live(signal); identity.outcome = recovered;
                    // Shown price is what THIS tap still charges: an attempt already started was charged (and deducted from the live balance) earlier.
                    prices.push({ cached: true, credits: 0 }); continue;
                } catch (error) {
                    if (!(error instanceof ApiError) || error.code !== 'request_not_found') throw error;
                }
            }
            const response = await api.request<{ clips: BestCutPrice[] }>(`${SPEECH_PATH}/preflight`, {
                method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: [identities.get(clip.media.id)!.source] }),
            }, { owner: account, timeoutMs: 90000 });
            live(signal);
            if (!Array.isArray(response.clips) || response.clips.length !== 1) throw new ApiError(200, 'bad_response');
            prices.push(response.clips[0]);
        }
        live(signal);
        if (!Array.isArray(prices) || prices.length !== clips.length || prices.some(p => typeof p.cached !== 'boolean' || !Number.isSafeInteger(p.credits) || p.credits < 0 || (p.cached && p.credits !== 0))) throw new ApiError(200, 'bad_response');
        notify('preflight', 0, 0, prices);
        if (prices.some(p => !p.cached && p.credits !== quote.credits)) throw new ApiError(409, 'price_changed');
        const inputs: BestCutInput[] = [], silent: string[] = [];
        for (const [index, clip] of clips.entries()) {
            live(signal); const identity = identities.get(clip.media.id)!, price = prices[index];
            identity.key ||= speechKeyFor(account, `best-cut:${clip.media.id}`, clip.duration, makeKey);
            notify('transcribing', index, 0, prices);
            let result = identity.outcome;
            try {
                if (!result) {
                    result = await startSpeech(api, { account, source: identity.source, duration: clip.duration, key: identity.key, credits: price.credits, cacheOnly: price.cached, bestCut: true }, signal);
                    identity.paid ??= result.credits ?? price.credits;
                    if (result.status === 'queued') result = await pollSpeech(api, identity.key, account, signal, () => notify('transcribing', index, 0, prices));
                    live(signal); identity.outcome = result;
                }
                if (result.credits !== undefined) identity.paid = result.credits;
                if (result.refunded) refunds.set(clip.media.id, identity.paid ?? price.credits);
                if (result.status === 'failed') throw new ApiError(409, 'request_failed_refunded', { refunded: result.refunded });
                if (result.speech === false) silent.push(clip.media.id);
                else if (result.analysis) inputs.push({ mediaId: clip.media.id, analysis: result.analysis });
                else throw new ApiError(200, 'bad_response');
            } catch (error) {
                if (error instanceof ApiError && error.body.refunded === true) {
                    refunds.set(clip.media.id, typeof error.body.credits === 'number' ? error.body.credits : identity.paid ?? price.credits);
                    // Only a definitive refund permits a new paid retry, on another explicit tap.
                    forgetSpeechKey(account, `best-cut:${clip.media.id}`);
                    // Keep the verified upload: re-uploading would count against the 200 MiB reservation budget. Only the receipt is reset.
                    identities.set(clip.media.id, { source: identity.source });
                }
                notify('ready', index, 0, prices); throw error;
            }
        }
        notify(inputs.length ? 'complete' : 'no-speech', clips.length, 1, prices);
        return { inputs, silent, refunded: [...refunds.values()].reduce((a, b) => a + b, 0) };
    }
    return { run, identities };
}
