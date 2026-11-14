// Long messages (ADR-0067 amendment 17). The same rules as lib/chatLimits.js on the server: a message over 8,000
// characters or 2,000 estimated tokens is long and adds the model's catalog extra; a model without that extra keeps 8,000.
// This only reads what GET /api/v1/chat/models lists; the server prices the turn itself and charges that.

export const CHAT_USER_TEXT_STANDARD_MAX = 8000;
export const CHAT_USER_TEXT_MAX = 30000;

export interface LongTextModel {
    readonly max_message_chars?: number;
    readonly options?: { readonly long_text?: { readonly extra_credits: number } | null };
}

export interface LongTextState {
    readonly limit: number;
    readonly long: boolean;
    readonly extra: number;
    readonly tooLong: boolean;
    readonly showCounter: boolean;
    readonly count: number;
}

// A quarter per ASCII code point, one per anything else (lib/chatLimits.js estimateTokens).
export function estimateTokens(text: string): number {
    let ascii = 0;
    let other = 0;
    for (const ch of text) { if ((ch.codePointAt(0) ?? 0) < 0x80) ascii += 1; else other += 1; }
    return Math.ceil(ascii / 4) + other;
}

export const isLongText = (text: string): boolean =>
    text.length > CHAT_USER_TEXT_STANDARD_MAX || estimateTokens(text) > CHAT_USER_TEXT_STANDARD_MAX / 4;

export function messageLimit(model: LongTextModel | null | undefined): number {
    const max = model?.max_message_chars;
    return Number.isInteger(max) && (max as number) > 0 ? (max as number) : CHAT_USER_TEXT_STANDARD_MAX;
}

export function longTextExtra(model: LongTextModel | null | undefined, text: string): number {
    const offer = model?.options?.long_text;
    return isLongText(text) && offer && Number.isInteger(offer.extra_credits) && offer.extra_credits > 0 ? offer.extra_credits : 0;
}

// The counter shows once the text is long or close to the model's limit; over the limit (or long on a model without the
// extra) the message cannot be sent.
export function longTextState(model: LongTextModel | null | undefined, text: string): LongTextState {
    const limit = messageLimit(model);
    const long = isLongText(text);
    const extra = longTextExtra(model, text);
    const tooLong = text.length > limit || estimateTokens(text) > limit / 4 || (long && extra === 0);
    return { limit, long, extra, tooLong, showCounter: long || tooLong || text.length > limit - 1000, count: text.length };
}
