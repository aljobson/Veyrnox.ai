import { pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { beatEnglish } from './beatDisplay.mjs';
import { PRESETS } from '../../../../../lib/musicInstruments.js';

export function trackSummary(tracks, t = beatEnglish, locale = 'en') {
  const midi = tracks.filter((t) => t.kind === 'midi').length;
  if (midi) return t(pluralKey(t, locale, 'app.music.beat.recovery.midiTracks', tracks.length), { count: tracks.length, midi });
  const audio = tracks.filter((track) => track.kind === 'audio').length;
  if (tracks.length === 1) return audio ? t('app.music.beat.recovery.r93') : PRESETS.drums.find((kit) => kit.id === tracks[0].kit)?.label || 'Drums';
  return audio ? t('app.music.beat.recovery.r89', { count: tracks.length, audio }) : t('app.music.beat.recovery.r90', { count: tracks.length });
}
