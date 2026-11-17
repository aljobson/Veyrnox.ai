import { createBeat, validateBeat } from './beatDocument.mjs';
import { edit, clearPattern } from './beatOps.mjs';
import { addMidiTrack, insertMidiRegion } from './beatMidiOps.mjs';

// Client-only: these identifiers also serve as the Worker bundle sentinels.
export const BEAT_TEMPLATES = Object.freeze(['hiphop', 'lofi', 'house', 'blank'].map(id => Object.freeze({
  id, nameKey: `app.music.beat.template.${id}`, descriptionKey: `app.music.beat.template.${id}.description`,
})));

export function createBeatFromTemplate({ template = 'blank', id, title, now = Date.now() }) {
  if (!BEAT_TEMPLATES.some(item => item.id === template)) throw new RangeError('Unknown beat template');
  let doc = createBeat({ id, title, now });
  if (template === 'blank') {
    doc = clearPattern(doc, now);
    doc = edit(doc, now, d => {
      d.view = 'pattern'; d.tracks[0].regions[0].length = 3840; d.cycle.end = 3840;
    });
  } else {
    doc = edit(doc, now, d => {
      d.tempo.bpm = { hiphop: 90, lofi: 80, house: 124 }[template];
      d.swing = { hiphop: 0.16, lofi: 0.3, house: 0 }[template];
      d.patterns.A.rows.kick = (template === 'house' ? [0, 4, 8, 12] : template === 'lofi' ? [0, 7, 10] : [0, 6, 8, 14]).map(step => [step, 100]);
      d.patterns.A.rows.hat = Array.from({ length: 8 }, (_, i) => [i * 2, i % 2 ? 60 : 100]);
    });
    if (template !== 'house') {
      doc = addMidiTrack(doc, { engine: 'voice', id: 'piano', preset: 'electric' }, now);
      doc = edit(doc, now, d => {
        const notes = (template === 'lofi' ? [57, 60, 64, 67] : [45, 48, 52, 55]).map((pitch, i) => [i * 960, 720, pitch, 80]);
        const region = insertMidiRegion(d, d.tracks.at(-1).id, 0, 3840, notes);
        region.length = 4 * 3840;
      });
    }
  }
  if (!validateBeat(doc).ok) throw new Error('Invalid beat template');
  return doc;
}
