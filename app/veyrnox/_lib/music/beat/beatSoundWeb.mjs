import { renderStarterSound } from './beatSoundRenderer.mjs';

// Keep the browser adapter import-safe so its behavior can be verified without
// loading the wider beat asset module and its browser-only dependencies.
export const createWebSoundRenderer = createOfflineContext => (ref, bpm, random) =>
  renderStarterSound(ref, bpm,
    (channels, frames, _sampleRate) => createOfflineContext(channels, frames), random);
