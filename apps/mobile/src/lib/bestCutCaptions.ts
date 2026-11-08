import { clean } from './editorAgentOperations';
import type { TextClip } from './nativeEditorModel';
import type { BestCutInput, BestCutPlan } from './bestCutPlan';
/** Keep provider words intact (including Arabic shaping and CJK grapheme clusters). */
export function bestCutCaptions(plan: BestCutPlan, inputs: BestCutInput[], trackId: string, seq: number, available = 150): { items: TextClip[]; seq: number; omitted: boolean } {
    const words: { text: string; start: number; end: number; range: number }[] = [];
    let omitted = false;
    plan.ranges.forEach((range, index) => {
        const analysis = inputs.find(c => c.mediaId === range.mediaId)?.analysis;
        if (!analysis || analysis.language === 'und') { omitted = true; return; }
        for (const word of analysis.chunks) {
            const from = Math.floor(word.start * plan.fps + 1e-7), to = Math.ceil(word.end * plan.fps - 1e-7);
            // A partially cut word is not captioned as though it were spoken in full.
            if (from < range.from || to > range.to || to <= from) continue;
            words.push({ text: clean(word.text), start: range.start + from - range.from, end: range.start + to - range.from, range: index });
        }
    });
    for (let group = 1; group <= 3; group++) {
        const items: TextClip[] = []; let next = seq;
        for (let i = 0; i < words.length;) {
            const batch = [words[i++]];
            while (batch.length < group && i < words.length && words[i].range === batch[0].range && clean(batch.map(w => w.text).join(' ') + ' ' + words[i].text).length < 200) batch.push(words[i++]);
            const text = clean(batch.map(w => w.text).join(' ')); if (!text) continue;
            items.push({ id: `t${++next}`, text, start: batch[0].start, len: Math.max(...batch.map(w => w.end)) - batch[0].start, trackId, x: .5, y: .85, size: 6 });
        }
        if (items.length <= available) return { items, seq: next, omitted };
    }
    return { items: [], seq, omitted: true };
}
