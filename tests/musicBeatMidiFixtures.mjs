import { make } from './musicBeatFixtures.mjs';
import { addMidiTrack, addMidiRegion } from '../app/veyrnox/_lib/music/beat/beatMidiOps.mjs';
export const bass = { engine: 'voice', id: 'bass', preset: 'sub' };
export function midiDoc(notes = []) {
  let doc = addMidiRegion(addMidiTrack(make(), bass, 0), 't2', 0, 0);
  doc.tempo.bpm = 120; doc.clips.c1.notes = notes;
  return doc;
}
