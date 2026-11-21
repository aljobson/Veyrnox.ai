import { fillerRanges, FILLER_WORDS } from '../src/lib/speechFillers';
import { parseSmartCutAnalysis } from '../src/lib/speechCut';
const web = require('../../../app/veyrnox/_lib/smartCutAnalysis.js');
const webFillers = require('../../../app/veyrnox/_lib/smartCutFillers.js');
const assetId = 'take-a';
const scribe = (language_code: string, tokens: [string, number, number][], duration = 12) => {
    const value = web.normaliseScribeResult({ assetId, duration, result: { language_code, text: tokens.map(t => t[0]).join(' '),
        words: tokens.map(([text, start, end]) => ({ type: 'word', text, start, end })) } });
    const parsed = parseSmartCutAnalysis(value.analysis, { assetId, duration }); if (!parsed.ok) throw Error(parsed.error); return parsed.analysis;
};
const cases: [string, [string, number, number][]][] = [
    ['eng', [['So', .5, .8], ['um,', 1, 1.3], ['we', 1.5, 1.7], ['uh', 2, 2.2], ['go', 2.25, 2.5]]],
    ['eng', [['Hello', .5, .9], ['um', 1, 1.2], ['uh', 1.22, 1.4], ['there', 1.6, 1.9]]],
    ['eng', [['I', .5, .6], ['like', .7, .9], ['so', 1, 1.1], ['well', 1.2, 1.4]]],
    ['deu', [['Also', .5, .8], ['ähm', 1, 1.3], ['gut', 1.5, 1.8]]], ['fra', [['Alors', .5, .8], ['euh', 1, 1.3], ['oui', 1.5, 1.8]]],
    ['rus', [['Ну', .5, .8], ['эм', 1, 1.3], ['да', 1.5, 1.8]]], ['zho', [['um', 1, 1.2]]], ['xxx', [['um', 1, 1.2]]],
];
test.each(cases)('%s filler suggestions match the web detector', (language, tokens) => {
    const analysis = scribe(language, tokens);
    expect(fillerRanges(analysis)).toEqual(webFillers.smartCutFillerRanges(analysis));
});
test('phrase-level timing proposes nothing and the lexicons match web', () => {
    const analysis = { ...scribe('eng', [['um', 1, 1.2]]), timingQuality: 'phrase' as const };
    expect(fillerRanges(analysis)).toEqual([]);
    expect(webFillers.smartCutFillerRanges(analysis)).toEqual([]);
    expect(FILLER_WORDS).toEqual(webFillers.SMART_CUT_FILLER_WORDS);
});

test('the selected range is applied before the fifty-suggestion cap', () => {
    const early = Array.from({ length: 51 }, (_, index) => ({ start: index * 0.5, end: index * 0.5 + 0.1, text: 'um' }));
    const ranged = { ...scribe('eng', [['um', 55, 55.2]], 60), chunks: [...early, { start: 55, end: 55.2, text: 'um' }] };

    expect(fillerRanges(ranged)).toHaveLength(50);
    expect(fillerRanges(ranged, { start: 54, end: 56 })).toEqual([{ start: 54.97, end: 55.23, label: 'um' }]);
    expect(fillerRanges(ranged, { start: 54, end: 56 })).toEqual(webFillers.smartCutFillerRanges(ranged, { start: 54, end: 56 }));
});
