import { utf8Bytes } from '../../src/lib/editorBridge';
import { emptyTimeline } from '../../src/lib/nativeEditorModel';
import { envelope } from './webSequenceV3';

export function nearLimit(envelopeLimit: boolean) {
    const tl = emptyTimeline(); tl.media.m = { id: 'm', kind: 'video', name: 'Source', frames: 900, hasAudio: true, width: 640, height: 360 };
    for (let i = 0; i < 28; i++) tl.text.push({ id: `t${i + 1}`, text: 'x'.repeat(950), start: i * 100, len: 90, trackId: 'text-0', x: .5, y: .8, size: 6 });
    const doc = envelope(tl), target = envelopeLimit ? 29000 : 29960;
    tl.text[27].text += 'x'.repeat(Math.max(0, Math.min(1000 - 950, target - utf8Bytes(JSON.stringify(tl)))));
    // Tune total byte length using valid text lengths; the completed backup adds ~110 bytes.
    while (utf8Bytes(JSON.stringify(tl)) > target) tl.text[27].text = tl.text[27].text.slice(0, -1);
    while (utf8Bytes(JSON.stringify(tl)) < target) {
        const item = tl.text.find(c => c.text.length < 1000)!; item.text += 'x';
    }
    if (envelopeLimit) doc.brief = 'b'.repeat(32720 - utf8Bytes(JSON.stringify(doc)));
    return doc;
}
