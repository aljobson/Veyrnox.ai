import { PRESETS } from '../../../../../lib/musicInstruments.js';

export function trackSummary(tracks) {
  const audio = tracks.filter((track) => track.kind === 'audio').length;
  if (tracks.length === 1) return audio ? '1 audio track' : PRESETS.drums.find((kit) => kit.id === tracks[0].kit)?.label || 'Drums';
  return audio ? `${tracks.length} tracks · ${audio} audio` : `${tracks.length} drum tracks`;
}
