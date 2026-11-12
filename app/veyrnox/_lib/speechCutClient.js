// Web client for the paid speech analysis behind Smart Cut (ADR-0331). Same contract as the phone's
// apps/mobile/src/lib/speechAnalysis.ts: quote, one confirmed POST per clip, then owner-only polling by key.
// The fetcher is injected (gatewayFetch in the app) so the money paths are testable without a network.
import { parseSmartCutAnalysis } from './smartCutAnalysis.js';

export const SPEECH_PATH = '/editor/speech-analyses';
export const POLL_DEADLINE_MS = 180000;
const fail = (status, code, body = {}) => Object.assign(new Error(code), { status, code, body });

/** { credits, maxSeconds } or null when the server says the feature is off (501). */
export async function fetchSpeechQuote(fetcher) {
  try {
    const result = await fetcher(`${SPEECH_PATH}/quote`);
    if (!Number.isSafeInteger(result?.credits) || result.credits < 1 || !Number.isSafeInteger(result.max_seconds) || result.max_seconds < 1 || !Array.isArray(result.languages)) throw fail(200, 'bad_response');
    return { credits: result.credits, maxSeconds: result.max_seconds };
  } catch (error) {
    if (error?.status === 501) return null;
    throw error;
  }
}

function outcome(value) {
  if (!value || !['queued', 'completed', 'failed'].includes(value.status)) throw fail(200, 'bad_response');
  if (value.status === 'completed' && value.speech === false) return value;
  if (value.status === 'completed') {
    const parsed = parseSmartCutAnalysis(value.analysis);
    if (!parsed.ok) throw fail(200, 'bad_response');
    return { ...value, analysis: parsed.analysis };
  }
  return value;
}

const recover = async (fetcher, key) => outcome(await fetcher(`${SPEECH_PATH}/by-key/${encodeURIComponent(key)}`));

/** One charge per key. A definite refusal throws; an unclear failure looks the key up instead of sending again. */
export async function startSpeech(fetcher, { jobId, duration, key, credits }) {
  try {
    return outcome(await fetcher(SPEECH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { type: 'job', jobId }, duration, idempotencyKey: key, expectedCredits: credits }),
    }));
  } catch (error) {
    if (error?.body?.refunded === true || (error?.status > 0 && error.status < 500 && error.code !== 'bad_response')) throw error;
    try { return await recover(fetcher, key); } catch { throw fail(503, 'outcome_pending'); }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pollSpeech(fetcher, key, { signal, onProgress = () => {}, sleep = wait, now = Date.now } = {}) {
  const started = now();
  let delay = 1000;
  for (;;) {
    if (signal?.aborted) throw fail(0, 'cancelled');
    const value = await recover(fetcher, key);
    if (value.status !== 'queued') return value;
    onProgress(value.progress === 'transcribing' ? 'transcribing' : 'queued');
    await sleep(delay);
    if (signal?.aborted) throw fail(0, 'cancelled');
    if (now() - started > POLL_DEADLINE_MS) throw fail(408, 'poll_timeout');
    delay = Math.min(10000, delay * 1.6);
  }
}

export const speechTotal = (credits, clipCount) => credits * clipCount;

/** Clips the server would refuse (no saved length, or longer than the quote allows). */
export const clipsOverLimit = (clips, maxSeconds) => clips.filter((clip) => !(Number(clip.duration) > 0 && Number(clip.duration) <= maxSeconds));

const ERROR_KEYS = {
  source_too_long: 'tooLong', source_unsupported: 'unsupported', duration_mismatch: 'durationChanged', price_changed: 'priceChanged',
  speech_cut_unavailable: 'unavailable', provider_admission_paused: 'unavailable', source_not_admitted: 'unavailable',
  insufficient_balance: 'balance', account_frozen: 'frozen', account_on_hold: 'frozen', rate_limited: 'rateLimited', speech_gate_cooldown: 'rateLimited',
  poll_timeout: 'timeout', outcome_pending: 'timeout', idempotency_conflict: 'conflict', not_found: 'failed',
};
export const speechErrorKey = (error) => `app.smartCut.analyse.error.${ERROR_KEYS[error?.code] || 'failed'}`;
