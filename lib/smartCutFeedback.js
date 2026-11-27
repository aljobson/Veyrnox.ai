import { readBoundedBody } from './boundedBody.js';
import { isUuid } from './validate.js';

export const SMART_CUT_FEEDBACK_PATH = '/editor/smart-cut-feedback';
export const SMART_CUT_FEEDBACK_MAX_BYTES = 1400;
export const SMART_CUT_FEEDBACK_COMMENT_MAX = 1000;
export const SMART_CUT_FEEDBACK_MODES = Object.freeze(['local-preview', 'transcript-silence']);

const RATINGS = new Set(['up', 'down']);
const MODES = new Set(SMART_CUT_FEEDBACK_MODES);
const KEYS = new Set(['response_id', 'rating', 'comment', 'plan_mode']);

export async function readSmartCutFeedbackJson(request) {
  try {
    const bytes = await readBoundedBody(request.body, SMART_CUT_FEEDBACK_MAX_BYTES, request.signal);
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch (error) {
    return { ok: false, error: error?.status === 413 ? 'body_too_large' : 'invalid_json' };
  }
}

export function parseSmartCutFeedback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !KEYS.has(key))) return { ok: false, error: 'invalid_request' };
  if (!isUuid(value.response_id) || !RATINGS.has(value.rating) || !MODES.has(value.plan_mode)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (value.comment !== undefined && typeof value.comment !== 'string') return { ok: false, error: 'invalid_request' };
  const comment = value.comment?.trim() || '';
  if (comment.length > SMART_CUT_FEEDBACK_COMMENT_MAX || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(comment)) {
    return { ok: false, error: 'invalid_request' };
  }
  return {
    ok: true,
    feedback: {
      response_id: value.response_id.toLowerCase(),
      rating: value.rating,
      ...(comment ? { comment } : {}),
      plan_mode: value.plan_mode,
    },
  };
}
