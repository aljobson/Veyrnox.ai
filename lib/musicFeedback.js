const FEEDBACK_KEYS = new Set(['value']);

export function parseMusicFeedback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.keys(value).every((key) => FEEDBACK_KEYS.has(key))) {
    return { ok: false, error: 'invalid_request' };
  }
  if (![null, 'like', 'dislike'].includes(value.value)) {
    return { ok: false, error: 'feedback_invalid' };
  }
  return { ok: true, value: value.value };
}
