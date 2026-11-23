// The phone's photo-slot hint (the whole sentence a photo token sits in, only a very long one shortened at word boundaries), worked
// out on the server for a template whose prompt is private (lib/templatePromptPrivacy.js). Same rules as
// apps/mobile/src/lib/templatePhotoHintText.ts, which a mobile test pins this against.
const SENTENCE_END = /[.!?\n]/;
export const PHOTO_HINT_MAX = 220;
const BEFORE = 80;

export function photoHintAround(source, offset, tokenLength) {
    let start = offset;
    while (start > 0 && !SENTENCE_END.test(source[start - 1])) start--;
    let end = offset + tokenLength;
    while (end < source.length && !SENTENCE_END.test(source[end - 1])) end++;
    let head = '';
    let tail = '';
    if (end - start > PHOTO_HINT_MAX) {
        const from = Math.max(start, offset - BEFORE);
        const to = Math.min(end, from + PHOTO_HINT_MAX);
        if (from > start) { start = source.indexOf(' ', from) + 1 || from; head = '…'; }
        if (to < end) { const space = source.lastIndexOf(' ', to); end = space > offset + tokenLength ? space : to; tail = '…'; }
    }
    return `${head}${source.slice(start, end).replace(/\s+/g, ' ').trim()}${tail}`;
}

export function phoneHints(contract) {
    if (contract?.class !== 'bound' || !contract.slotCount || !contract.tokenMap) return [];
    return Array.from({ length: contract.slotCount }, (_, index) => {
        const item = contract.tokenMap.find(entry => entry.slot === index + 1);
        return item ? photoHintAround(contract.sourcePrompt, item.offset, item.token.length) : '';
    });
}
