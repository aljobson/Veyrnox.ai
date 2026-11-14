import { CHAT_USER_TEXT_STANDARD_MAX, estimateTokens, isLongText } from '../../../lib/chatLimits.js';

/**
 * Long messages in the chat composer (ADR-0067 amendment 17). The server prices the reply; this only reads the catalog extra
 * the models route lists and the per-model limit, so the composer can show the total and the count before Send.
 */

/** The longest message this model takes: 30,000 characters when it offers the long-message extra, else 8,000. */
export function messageLimit(model) {
  const max = model && model.max_message_chars;
  return Number.isInteger(max) && max > 0 ? max : CHAT_USER_TEXT_STANDARD_MAX;
}

/**
 * What the composer needs for this text on this model: the extra Credits a long message adds (0 when it is not long),
 * whether the counter shows (once the text is long, or close to the limit), and whether it is over what this model takes.
 */
export function longTextState(model, text) {
  const value = typeof text === 'string' ? text : '';
  const limit = messageLimit(model);
  const long = isLongText(value);
  const offer = model && model.options && model.options.long_text;
  const extra = long && offer && Number.isInteger(offer.extra_credits) ? offer.extra_credits : 0;
  const tooLong = value.length > limit || estimateTokens(value) > limit / 4 || (long && !extra);
  return { limit, long, extra, tooLong, showCounter: long || tooLong || value.length > limit - 1000, count: value.length };
}
