// A live edit must not change graph topology or the scheduled envelope.
export const effectParamLive = param => param !== 'size';
export const sendLevelLive = (track, bus, value) => (track.sends?.[bus] > 0) === (value > 0);
export const masterPatchLive = (doc, patch) => Boolean(doc.master)
  && Object.keys(patch).every(key => ['gain', 'delay'].includes(key));
export function automationControl(track, lane, mode, recording = false) {
  const disabled = (mode === 'song' || recording) && Boolean(track.automation?.[lane]?.length);
  const message = lane === 'gain' ? 'Gain is automated — clear the lane to use the fader'
    : 'Pan is automated — clear the lane to use the pan control';
  return { disabled, message };
}
