const regions = (doc) => doc.tracks.flatMap((track) => track.regions.map((region) => ({ track, region })));
const bars = (region) => `${region.start / 3840 + 1} to ${(region.start + region.length) / 3840}`;

// Read committed results, including overlap resolution, for every input method.
export function arrangementMessage(before, after, { label, regionId, trackId, start }) {
  const previous = regions(before).find(({ region }) => region.id === regionId);
  const current = regions(after).find(({ region }) => region.id === regionId);
  const track = after.tracks.find((item) => item.id === trackId);
  switch (label) {
    case 'move region':
      return `Moved to bar ${current.region.start / 3840 + 1} on ${current.track.name}`;
    case 'copy region':
    case 'duplicate region':
    case 'add region': {
      const destination = label === 'duplicate region' ? previous.track.id : trackId;
      const at = label === 'duplicate region' ? previous.region.start + previous.region.length : start;
      const placed = after.tracks.find((item) => item.id === destination).regions.find((region) => region.start === at);
      const verb = label === 'copy region' ? 'Copied to' : label === 'duplicate region' ? 'Duplicated to' : 'Added at';
      return `${verb} bars ${bars(placed)}`;
    }
    case 'resize region':
    case 'trim region':
      return `Now bars ${bars(current.region)}`;
    case 'split region':
      return `Split at bar ${(current.region.start + current.region.length) / 3840 + 1}`;
    case 'delete region': return 'Region deleted';
    case 'change region pattern': return `Region now uses pattern ${current.region.pattern}`;
    case 'add track': return `Track added: ${after.tracks.find((item) => !before.tracks.some((old) => old.id === item.id)).name}`;
    case 'delete track': return `Track deleted: ${before.tracks.find((item) => item.id === trackId).name}`;
    case 'change track kit': return `${track.name} kit: ${track.kit}`;
    case 'change cycle': return `Cycle bars ${after.cycle.start / 3840 + 1} to ${after.cycle.end / 3840}`;
    default:
      if (track && label === `${track.mute ? 'mute' : 'unmute'} ${track.name}`) {
        return `${track.name} ${track.mute ? 'muted' : 'unmuted'}`;
      }
      if (track && label === `${track.solo ? 'solo' : 'unsolo'} ${track.name}`) {
        return `${track.name} solo ${track.solo ? 'on' : 'off'}`;
      }
      return null;
  }
}
