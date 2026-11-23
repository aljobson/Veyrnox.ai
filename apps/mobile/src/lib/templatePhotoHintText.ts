// The photo-slot reference line on a template. The shared helper cuts 40 characters either side of the token,
// which ends mid-word on the phone. Here the line is the whole sentence the token sits in; only a very long one
// is shortened, at word boundaries and with an ellipsis, so nothing is ever cut mid-word.
const SENTENCE_END = /[.!?\n]/;
export const PHOTO_HINT_MAX = 220;
const BEFORE = 80;

interface HintContract {
    class?: string;
    photoHints?: readonly string[];
    photoHintsPhone?: readonly string[];
    slotCount?: number;
    sourcePrompt: string;
    tokenMap?: readonly { slot: number; offset: number; token: string }[];
}

export function photoHintAround(source: string, offset: number, tokenLength: number): string {
    let start = offset;
    while (start > 0 && !SENTENCE_END.test(source[start - 1]!)) start--;
    let end = offset + tokenLength;
    while (end < source.length && !SENTENCE_END.test(source[end - 1]!)) end++;
    let head = '';
    let tail = '';
    if (end - start > PHOTO_HINT_MAX) {
        const from = Math.max(start, offset - BEFORE);
        const to = Math.min(end, from + PHOTO_HINT_MAX);
        if (from > start) { start = source.indexOf(' ', from) + 1 || from; head = '…'; }
        if (to < end) { const space = source.lastIndexOf(' ', to); end = space > offset + tokenLength ? space : to; tail = '…'; }
    }
    const text = source.slice(start, end).replace(/\s+/g, ' ').trim();
    return `${head}${text}${tail}`;
}

export function phonePhotoHints(contract: HintContract | null | undefined): string[] {
    const slotCount = contract?.slotCount;
    const tokenMap = contract?.tokenMap;
    // A template whose prompt is private carries its hints, cut out on the server (lib/templatePromptPrivacy.js).
    if (contract?.class === 'bound' && Array.isArray(contract.photoHintsPhone)) return [...contract.photoHintsPhone];
    if (contract?.class !== 'bound' || typeof slotCount !== 'number' || slotCount <= 0 || !tokenMap) return [];
    return Array.from({ length: slotCount }, (_, index) => {
        const item = tokenMap.find(entry => entry.slot === index + 1);
        return item ? photoHintAround(contract.sourcePrompt, item.offset, item.token.length) : '';
    });
}
