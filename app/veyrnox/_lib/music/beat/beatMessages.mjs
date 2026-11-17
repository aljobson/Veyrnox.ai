import messages from '../../../../../lib/i18n/messages/app/en/music-beat-messages.mjs';
import { translator } from '../../../../../lib/i18n/translate.mjs';
import timeMessages from '../../../../../lib/i18n/messages/app/en/music-beat-time.mjs';
const english = translator('en', { ...timeMessages, ...messages });
import { formatPosition } from './beatTime.mjs';
const regions = (doc) => doc.tracks.flatMap((track) => track.regions.map((region) => ({ track, region })));
const bars = (region, t) => t('app.music.beat.message.range', { start: formatPosition(region.start, t), end: formatPosition(region.start + region.length, t) });

// Read committed results, including overlap resolution, for every input method.
export function arrangementMessage(before, after, { label, regionId, trackId, start }, t = english) {
  const previous = regions(before).find(({ region }) => region.id === regionId);
  const current = regions(after).find(({ region }) => region.id === regionId);
  const track = after.tracks.find((item) => item.id === trackId);
  switch (label) {
    case 'add audio region': {
      const added = regions(after).find(({ region }) => !regions(before).some((old) => old.region.id === region.id) && region.assetId);
      return added ? t('app.music.beat.message.added', { name: after.assets[added.region.assetId].name, position: formatPosition(added.region.start, t) }) : t('app.music.beat.message.sound');
    }
    case 'move region':
      return t('app.music.beat.message.moved', { position: formatPosition(current.region.start, t), name: current.track.name });
    case 'copy region':
    case 'duplicate region':
    case 'add region': {
      const destination = label === 'duplicate region' ? previous.track.id : trackId;
      const at = label === 'duplicate region' ? previous.region.start + previous.region.length : start;
      const placed = after.tracks.find((item) => item.id === destination).regions.find((region) => region.start === at);
      const key = label === 'copy region' ? 'app.music.beat.message.copied' : label === 'duplicate region' ? 'app.music.beat.message.duplicated' : 'app.music.beat.message.placed';
      return t(key, { range: bars(placed, t) });
    }
    case 'resize region':
    case 'trim region':
      return t('app.music.beat.message.now', { range: bars(current.region, t) });
    case 'split region':
      return t('app.music.beat.message.split', { position: formatPosition(current.region.start + current.region.length, t) });
    case 'delete region': return t('app.music.beat.message.deleted');
    case 'change region pattern': return t('app.music.beat.message.pattern', { pattern: current.region.pattern });
    case 'add track': return t('app.music.beat.message.trackAdded', { name: after.tracks.find((item) => !before.tracks.some((old) => old.id === item.id)).name });
    case 'delete track': return t('app.music.beat.message.trackDeleted', { name: before.tracks.find((item) => item.id === trackId).name });
    case 'change track kit': return t('app.music.beat.message.kit', { name: track.name, kit: track.kit });
    case 'change cycle': return t('app.music.beat.message.cycle', { start: formatPosition(after.cycle.start, t), end: formatPosition(after.cycle.end, t) });
    default:
      if (track && label === `${track.mute ? 'mute' : 'unmute'} ${track.name}`) {
        return t(track.mute ? 'app.music.beat.message.muted' : 'app.music.beat.message.unmuted', { name: track.name });
      }
      if (track && label === `${track.solo ? 'solo' : 'unsolo'} ${track.name}`) {
        return t(track.solo ? 'app.music.beat.message.soloOn' : 'app.music.beat.message.soloOff', { name: track.name });
      }
      break;
  }
  if (before.tracks.some(t => {
    const remaining = after.tracks.find(n => n.id === t.id);
    return remaining && (t.takeGroups || []).some(g => !remaining.takeGroups?.some(n => n.id === g.id));
  })) return t('app.music.beat.message.merged');
  return null;
}
