import { beatEnglish } from './beatDisplay.mjs';
import { MIDI_LIMITS } from './beatMidiRules.mjs';
const BAR = 3840, MAX = MIDI_LIMITS.clipTicks;
export const recordingEndTick = (tempo) => Math.floor(Math.min(512 * BAR, 600 * tempo / 60 * 960) / 240) * 240;
export function partitionTake(notes, startTick, endLimit, announce = () => {}, t = beatEnglish) {
  const sorted = notes.map((n) => ({ ...n })).sort((a, b) => a.start - b.start || a.pitch - b.pitch), groups = [];
  let remaining = sorted, start = startTick;
  while (remaining.length) {
    if (remaining[0].start >= start + MAX) start = Math.floor(remaining[0].start / BAR) * BAR;
    // A gap may start mid-bar; subsequent boundaries still use bar lines.
    let boundary = Math.min(Math.floor((start + MAX) / BAR) * BAR, endLimit);
    const overflow = remaining.filter((n) => n.start < boundary)[2000];
    if (overflow) boundary = Math.floor(overflow.start / BAR) * BAR;
    if (boundary <= start) throw new Error('A bar can have at most 2,000 note onsets.');
    const later = remaining.some((n) => n.start >= boundary);
    if (later && !overflow) {
      // Prefer the latest free bar line, retaining complete held notes when possible.
      for (let line = Math.floor(boundary / BAR) * BAR; line > start; line -= BAR) {
        if (!remaining.some((n) => n.start < line && n.end > line)) { boundary = line; break; }
      }
    }
    const group = remaining.filter((n) => n.start < boundary);
    if (!group.length) { start = boundary; continue; }
    const crossing = group.some((n) => n.end > boundary);
    if (crossing) announce(t('app.music.beat.shared.splitNotes', { bar: Math.floor(boundary / BAR) + 1 }));
    for (const n of group) n.end = Math.min(n.end, boundary);
    const end = Math.min(boundary, Math.ceil(Math.max(...group.map((n) => n.end)) / BAR) * BAR);
    groups.push({ start, end, notes: group });
    remaining = remaining.filter((n) => n.start >= boundary); start = boundary;
  }
  return groups;
}
