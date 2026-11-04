// Pure helpers for the studio's image count (1–4 images per click). Each
// image is its own POST /api/v1/generations: its own idempotency key, debit,
// refund path and job. Nothing here talks to the network (unit-tested).

import { SEED_MAX } from './generationSettings.js';

export const IMAGE_COUNTS = [1, 2, 3, 4];

/** The count control is for image models only, never an Auto Short. */
export function takesImageCount(model) {
  return model?.kind === 'image' && !model?.takesTopic;
}

/** How many generations one click sends: the chosen count, or 1 for any other model. */
export function imageCount(model, count) {
  return takesImageCount(model) && IMAGE_COUNTS.includes(count) ? count : 1;
}

/** The catalog's per-unit price times the count — the only arithmetic. */
export function totalCost(unit, count) {
  return unit * count;
}

/** Seed for the i-th image, wrapping inside 0..SEED_MAX so the gateway accepts it. */
export function seedForIndex(seed, i) {
  return (seed + i) % (SEED_MAX + 1);
}

/** Inputs for the i-th request: a set seed shifts by i so the images differ. */
export function inputsForIndex(inputs, i, count) {
  if (count <= 1 || inputs.seed === undefined) return inputs;
  return { ...inputs, seed: seedForIndex(inputs.seed, i) };
}

// Codes where the gateway may have debited (and submitted) the request before
// the reply was lost: a dropped connection or client-side throw ('internal',
// 'network_error': fetch threw, but the request may already have reached us),
// a non-JSON 5xx, a ledger_debit RPC error, or a session swap after the reply.
const OUTCOME_UNKNOWN = new Set(['internal', 'network_error', 'gateway_error', 'debit_failed', 'account_changed', 'dispatch_acceptance_unknown', 'admission_unknown', 'outcome_unknown']);

/** The banner code for a failed submit: an unread reply may hide a charge. */
export function submitErrorCode(code) {
  return OUTCOME_UNKNOWN.has(code) ? 'outcome_unknown' : code;
}

/**
 * How many of a batch started, for the failure banner. Empty for a single
 * image. It makes no charge claim: ERROR_COPY words that for the failing
 * request, and an unknown outcome may have been charged.
 */
export function batchNote(started, count, code) {
  if (count <= 1) return '';
  const next = started + 1;
  return submitErrorCode(code) === 'outcome_unknown'
    ? `${started} of ${count} started; image ${next} may have too — check Library.`
    : `${started} of ${count} started; image ${next} did not.`;
}

// Provider refusals that arrive after a job existed and was refunded; the key is dead for a retry.
const REFUNDED_REFUSALS = new Set(['provider_moderation', 'provider_input_rejected', 'provider_submit_failed']);

/**
 * Run sendOne(0..count-1) one after another. Stops at the first throw and
 * never auto-retries. A continuation skips accepted items and retains keys.
 * @returns {Promise<{ started: number, error: unknown }>}
 */
export async function sendInOrder(count, sendOne, batch, makeKey) {
  let started = 0;
  for (let i = 0; i < count; i++) {
    if (batch?.accepted[i]) { started++; continue; }
    try {
      const result = await sendOne(i);
      if (batch) { batch.accepted[i] = result ?? true; batch.unknown.delete(i); }
    } catch (error) {
      if (batch) {
        const wasUnknown = batch.unknown.has(i);
        if (submitErrorCode(error?.code ?? 'internal') === 'outcome_unknown') batch.unknown.add(i);
        else if (REFUNDED_REFUSALS.has(error?.code)) {
          // The provider refused after a job existed and was refunded: that key is dead. With an accepted prefix the
          // item gets a fresh explicit retry key; otherwise the page starts a whole new batch.
          batch.unknown.delete(i);
          if (batch.accepted.some(Boolean) && makeKey) batch.keys[i] = makeKey();
        } else if (error?.code === 'price_changed') {
          // A replay of an accepted key never returns price_changed, so this proves no job exists; the key is kept.
          batch.unknown.delete(i);
        } else if (!wasUnknown) {
          // Other refusals prove nothing about an earlier lost reply, so an unknown item keeps its key and state.
          if (batch.accepted.some(Boolean) && makeKey) batch.keys[i] = makeKey();
        }
      }
      return { started, error };
    }
    started += 1;
  }
  return { started, error: null };
}

/** A batch keeps original indexes, keys and accepted results until inputs change. */
export function createBatch(count, makeKey) {
  return { keys: Array.from({ length: count }, makeKey), accepted: Array(count).fill(null), unknown: new Set() };
}

/** One immutable quote drives both the remaining total and outgoing ceilings.
 * Unknown items retain a paid ceiling, without consuming a new free allocation.
 */
export function allocationSnapshot(batch, unit, freeNow) {
  let free = Math.max(0, Math.floor(Number(freeNow) || 0));
  const ceilings = batch.accepted.map((result, i) => {
    if (result) return null;
    if (batch.unknown.has(i)) return unit;
    if (free > 0) { free--; return 0; }
    return unit;
  });
  // total is the most this click may charge (shown to the person). payable leaves out unknown items:
  // their retained key replays, which debits nothing if the lost reply hid an accepted job, so they
  // never block the affordability check. Their ceiling still caps a fresh admission.
  return { ceilings, total: ceilings.reduce((sum, value) => sum + (value ?? 0), 0),
    payable: ceilings.reduce((sum, value, i) => sum + (batch.unknown.has(i) ? 0 : (value ?? 0)), 0) };
}
