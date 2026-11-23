// Paid request shapes and the retry rule for the Performance studio (ADR-0374).

// Mirrors CAPTIONS_UNITS and MAX_OUTPUT_S in lib/clipEdit.js, which is server code.
export const CAPTION_UNITS = 7;
const CAPTION_UNIT_SECONDS = 5;
const MAX_EDIT_SECONDS = 60;

const REFUSED_AFTER_DEBIT = new Set(['provider_moderation', 'provider_input_rejected', 'topic_refused']);
const CHARGE_MAY_EXIST = new Set(['account_changed', 'idempotency_conflict', ...REFUSED_AFTER_DEBIT]);

const unresolved = new WeakSet();

function mayHaveCharged(error) {
  if (CHARGE_MAY_EXIST.has(error?.code)) return true;
  const status = error?.status;
  return !(Number.isInteger(status) && status >= 400 && status < 500) || status === 408;
}

/** True when a paid request failed without proving that it went uncharged. */
export function isChargeUnknown(error) {
  return Boolean(error) && typeof error === 'object' && unresolved.has(error);
}

/** The provider refused after the debit; the server refunds these. */
export function isProviderRefusal(error) {
  return REFUSED_AFTER_DEBIT.has(error?.code);
}

function markUnresolved(error) {
  if (error && typeof error === 'object') unresolved.add(error);
  return error;
}

/**
 * One idempotency key per paid request until its outcome is known. A retry of
 * an unresolved request looks the key up first: a found job is adopted, a
 * refunded one starts afresh, and anything else replays the identical body,
 * because ledger_debit refuses a known key with different inputs.
 */
export function createChargeAttempts({ post, lookup, makeKey, owner = () => '' }) {
  const open = new Map();

  async function send(request) {
    const id = `${owner() || ''}\n${JSON.stringify(request)}`;
    let attempt = open.get(id);
    if (attempt) {
      let found;
      try {
        found = await lookup(attempt.key);
      } catch (error) {
        throw markUnresolved(error);
      }
      if (found?.job?.refunded) {
        open.delete(id);
        attempt = null;
      } else if (found?.job?.id) {
        open.delete(id);
        return { job_id: found.job.id, idempotent: true, recovering: true };
      }
    }
    const replay = Boolean(attempt);
    if (!attempt) {
      attempt = { key: makeKey() };
      open.set(id, attempt);
    }
    try {
      const result = await post({ ...request, idempotency_key: attempt.key });
      open.delete(id);
      return replay ? { ...result, recovering: true } : result;
    } catch (error) {
      if (replay || mayHaveCharged(error)) throw markUnresolved(error);
      open.delete(id);
      throw error;
    }
  }

  return { send };
}

/** Every source names its slot: the server reads a bare asset id as an image. */
export function lipSyncRequest({ model, sourceKind, visualKey, visualAssetId, audioKey, audioJobId, syncMode }) {
  const visualSlot = sourceKind === 'video' ? 'video' : 'image';
  return {
    model_id: model.id,
    confirmed_credits: model.credits,
    inputs: model.id === 'sync-lipsync-1.9-long' ? { sync_mode: syncMode } : {},
    source_keys: [
      visualKey && { key: visualKey, slot: visualSlot },
      audioKey && { key: audioKey, slot: 'audio' },
    ].filter(Boolean),
    source_assets: [
      visualAssetId && { asset_id: visualAssetId, slot: visualSlot },
      audioJobId && { asset_id: audioJobId, slot: 'audio' },
    ].filter(Boolean),
    consent: true,
  };
}

export function captionRequest({ baseJobId, seconds, preset, confirmedCredits }) {
  return {
    model_id: 'clip-edit',
    confirmed_credits: confirmedCredits,
    inputs: {
      clips: [{ asset_id: baseJobId, in_s: 0, out_s: Math.round(seconds * 100) / 100 }],
      captions: { preset },
    },
  };
}

/** The most burned subtitles can cost for a video up to maxSeconds long. */
export function captionCeilingCredits(unitCredits, maxSeconds) {
  if (!Number.isFinite(unitCredits)) return 0;
  const seconds = Math.min(Number(maxSeconds) || 0, MAX_EDIT_SECONDS);
  return unitCredits * Math.max(CAPTION_UNITS, Math.ceil(seconds / CAPTION_UNIT_SECONDS));
}

function captionStop(userMessage) {
  return Object.assign(new Error('caption_not_started'), { code: 'caption_not_started', userMessage });
}

/**
 * Reads the finished clip's length, asks the server for the price with a
 * request pinned to 0 credits (refused uncharged), then charges that price
 * through the attempt path. A price above the approved one stops here.
 */
export async function submitCaption({ attempts, post, makeKey, fetchLength, baseJobId, preset, approvedCredits }) {
  const seconds = await fetchLength(baseJobId);
  if (!(Number.isFinite(seconds) && seconds > 0)) {
    throw captionStop('The video length could not be read, so subtitles did not start and nothing was charged for them.');
  }
  let credits;
  try {
    const free = await post({
      ...captionRequest({ baseJobId, seconds, preset, confirmedCredits: 0 }),
      idempotency_key: makeKey(),
    });
    if (free?.job_id) return { ...free, credits: 0 };
    throw captionStop('The subtitle price could not be confirmed, so nothing was charged for them.');
  } catch (error) {
    if (error?.code !== 'credit_confirmation_mismatch') throw error;
    credits = Number(error.body?.expected_credits);
  }
  if (!Number.isInteger(credits) || credits < 0) {
    throw captionStop('The subtitle price could not be confirmed, so nothing was charged for them.');
  }
  if (credits > approvedCredits) {
    throw captionStop(`Subtitles now cost ${credits} credits, more than the ${approvedCredits} you approved, so nothing was charged for them.`);
  }
  const submitted = await attempts.send(captionRequest({ baseJobId, seconds, preset, confirmedCredits: credits }));
  return { ...submitted, credits };
}
