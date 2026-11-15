import { gatewayFetch } from '../../gateway.js';
import { privateMusicAssetPath } from '../../useMusicAudioSrc.jsx';
import { AUDIO_RATE } from './beatAudioRules.mjs';
import { fetchAudioAsset } from './beatAudioFetch.mjs';
export { decodes } from './beatAudioFetch.mjs';
export const offline = (channels = 1, frames = 1) => {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Sound isn't available in this browser");
  return new Offline(channels, frames, AUDIO_RATE);
};
export async function loadSong(base, stored = null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const path = privateMusicAssetPath(`/api/v1/jobs/${base.ref.jobId}/asset`);
      if (!path) throw new Error('This song version is no longer available');
      const signed = await gatewayFetch(path);
      if (!signed?.url) throw new Error('This song version is no longer available');
      return await fetchAudioAsset(signed.url, base, stored, { decode: (bytes) => offline().decodeAudioData(bytes) });
    } catch (error) {
      if (attempt === 0 && [401, 403].includes(error.status)) continue;
      throw error;
    }
  }
}
