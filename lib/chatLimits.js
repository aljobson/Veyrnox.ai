// Chat is priced and token-budgeted independently from media generation.
// A message up to the standard length costs the row's flat price. A longer one, up to the maximum, also costs the row's
// long-message extra (ADR-0067 amendment 17); a row without that extra keeps the standard length.
export const CHAT_USER_TEXT_STANDARD_MAX = 8_000;
export const CHAT_USER_TEXT_MAX = 30_000;

/**
 * A conservative token count: a quarter per ASCII code point, one per anything else. Never below the real
 * figure for the tokenizers in use, and equal to the four-characters-a-token rule for plain English.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
    if (typeof text !== 'string' || !text) return 0;
    let ascii = 0, other = 0;
    for (const ch of text) { if (ch.codePointAt(0) < 0x80) ascii += 1; else other += 1; }
    return Math.ceil(ascii / 4) + other;
}

/** Whether a message is over the standard length the flat price covers, in characters or in estimated tokens. */
export function isLongText(text) {
    return typeof text === 'string' && (text.length > CHAT_USER_TEXT_STANDARD_MAX || estimateTokens(text) > CHAT_USER_TEXT_STANDARD_MAX / 4);
}
