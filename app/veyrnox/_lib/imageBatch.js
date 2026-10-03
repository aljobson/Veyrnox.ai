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
// the reply was lost: a dropped connection or client-side throw ('internal'),
// a non-JSON 5xx, a ledger_debit RPC error, or a session swap after the reply.
const OUTCOME_UNKNOWN = new Set(['internal', 'gateway_error', 'debit_failed', 'account_changed']);

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
  return code === 'outcome_unknown'
    ? `${started} of ${count} started; image ${next} may have too — check Library.`
    : `${started} of ${count} started; image ${next} did not.`;
}

/**
 * Run sendOne(0..count-1) one after another. Stops at the first throw and
 * never retries: a retry would need a new idempotency key, which is a new
 * charge the user did not ask for.
 * @returns {Promise<{ started: number, error: unknown }>}
 */
export async function sendInOrder(count, sendOne) {
  let started = 0;
  for (let i = 0; i < count; i++) {
    try {
      await sendOne(i);
    } catch (error) {
      return { started, error };
    }
    started += 1;
  }
  return { started, error: null };
}
