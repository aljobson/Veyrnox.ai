import { checkFaces } from '../../../lib/templateSwapCutout.mjs';
import { JOB_STATES, publicJobState } from '../../../lib/jobState.js';
import { submitErrorCode } from './imageBatch.js';

export async function fetchSwapAvailability(id, fetcher = fetch, signal) {
  if (!id) return null;
  try {
    // A hung catalog request must not block the existing template and Create pages: give up after 4 s.
    const limit = AbortSignal.timeout(4000), joined = signal ? AbortSignal.any([signal, limit]) : limit;
    const response = await fetcher(`/api/catalog?template_swap=${encodeURIComponent(id)}`, { cache: 'no-store', signal: joined });
    if (response.status !== 200) return null;
    const c = await response.json();
    return c?.id === id && c.model === 'kling-o1-reference' && Number.isInteger(c.credits) && c.credits > 0
      && c.durationSeconds === 5 && c.images === 2 && typeof c.role === 'string' && c.role.trim() ? c : null;
  } catch { return null; }
}

export function faceBoxFromResult(result, size) {
  if (result?.count === 0) return { ok: false, error: 'no_face' };
  if (result?.count >= 2) return { ok: false, error: 'several_people' };
  const points = result?.landmarks;
  if (result?.count !== 1 || !(points instanceof Float32Array) || points.length !== 478 * 3 || !points.every(Number.isFinite)) return { ok: false, error: 'invalid_face' };
  let left = 1, top = 1, right = 0, bottom = 0;
  const clamp = n => Math.max(0, Math.min(1, n));
  for (let i = 0; i < points.length; i += 3) {
    const x = clamp(points[i]), y = clamp(points[i + 1]);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return checkFaces([{ x: left * size.width, y: top * size.height, width: (right - left) * size.width, height: (bottom - top) * size.height }], size);
}

export function swapRequest(offer, key, references) {
  if (!offer?.id || !offer.model || !Number.isInteger(offer.credits) || !key || references?.length !== 2
      || references.some(r => r.slot !== 'image' || r.origin !== 'upload' || typeof r.key !== 'string' || !r.key)) throw Error('invalid_swap_request');
  return { template_swap: offer.id, model_id: offer.model, idempotency_key: key, inputs: {},
    max_charge_credits: offer.credits, references: references.map(r => ({ ...r })), consent: true };
}
const PRE_DEBIT = new Set(['template_swap_image_size', 'template_swap_image_type', 'template_swap_photo_count',
  'template_swap_not_found', 'template_blocked', 'consent_required', 'price_changed', 'insufficient_balance', 'rate_limited', 'unauthenticated', 'no_token']);
const PROVIDER_REFUSAL = new Set(['provider_moderation', 'provider_input_rejected', 'provider_submit_failed']);
export const unsettled = a => ['submitting', 'unknown', 'unresolved', 'refund_pending', 'queued', 'running'].includes(a.state);
export function reduceAttempt(attempt, event) {
  const a = { ...attempt };
  if (event.error) {
    const e = event.error;
    a.errorCode = e.code || 'internal';
    a.job_id = e.body?.job_id || a.job_id;
    if (a.job_id && PROVIDER_REFUSAL.has(a.errorCode)) { a.refusal = true; a.state = 'refund_pending'; }
    else if (a.uncertain || submitErrorCode(a.errorCode) === 'outcome_unknown') { a.uncertain = true; a.state = 'unknown'; }
    else if (!a.responses && e.status >= 400 && e.status < 500 && !a.job_id && PRE_DEBIT.has(a.errorCode)) a.state = 'not_charged';
    else { a.uncertain = true; a.state = 'unknown'; }
    a.responses = (a.responses || 0) + 1;
  } else if (event.accepted) {
    a.job_id = event.accepted.job_id; a.state = 'queued'; a.uncertain = false;
    a.balance = event.accepted.balance_after;
    a.spent = event.accepted.free_allowance === true ? 0 : a.body?.max_charge_credits;
  } else if (event.job) {
    const job = event.job; a.job_id = job.id;
    if (job.refunded === true && job.refund_state === 'confirmed') a.state = 'refunded';
    else if (job.state === 'succeeded') a.state = 'succeeded';
    else if (a.refusal || job.refund_state === 'pending' || job.state === 'failed') a.state = 'refund_pending';
    else if (!a.uncertain) a.state = job.state;
    // RUNNING means the provider accepted the job; QUEUED stays unknown because a refused submit whose refund failed also reads as queued.
    else if (job.state === 'running') { a.uncertain = false; a.state = 'running'; }
  }
  return a;
}
const states = new Set(JOB_STATES.map(publicJobState));
export async function lookupJobByKey(key, gateway, signal) {
  const { job } = await gateway(`/jobs?idempotency_key=${encodeURIComponent(key)}`, { cache: 'no-store', signal });
  if (job === null) return null;
  if (!job || typeof job.id !== 'string' || !states.has(job.state) || typeof job.refunded !== 'boolean'
      || !['confirmed', 'pending', 'none', 'unknown'].includes(job.refund_state)) throw Error('invalid_job');
  return job;
}
export function swapErrorKey(code) {
  const aliases = { template_swap_image_size: 'photo_too_small', template_swap_image_type: 'invalid_image', template_swap_photo_count: 'invalid_image',
    template_swap_not_found: 'unavailable', consent_required: 'rights', no_person: 'busy_background', person_coverage: 'busy_background',
    invalid_mask: 'cutout_failed', invalid_face: 'no_face', no_token: 'session', unauthenticated: 'session',
    NotAllowedError: 'permission', SecurityError: 'permission', network_error: 'offline', upload_failed: 'upload_failed', insufficient_balance: 'insufficient_balance', rate_limited: 'rate_limited',
    mfa_required: 'access_denied', account_frozen: 'access_denied', forbidden: 'access_denied', provider_input_rejected: 'rejected', provider_moderation: 'rejected', provider_submit_failed: 'rejected' };
  const allowed = ['busy_background', 'ragged_matte', 'several_people', 'no_face', 'face_too_small', 'photo_too_large', 'photo_too_small', 'invalid_image', 'price_changed'];
  return `presets.swap.${aliases[code] || (allowed.includes(code) ? code : 'cutout_failed')}`;
}
