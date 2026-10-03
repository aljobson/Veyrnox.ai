import { useSyncExternalStore } from 'react';

// The Cinema preview flag. '1' matches every other veyrnox_* preview flag;
// 'true' is the value the handoff doc gave out first, so it still works.
const never = () => () => {};
const off = () => false;

// The flag as a hook: off on the server and during hydration, then whatever
// this browser has stored.
export function useCinemaPreview() {
  return useSyncExternalStore(never, cinemaPreviewEnabled, off);
}

export function cinemaPreviewEnabled() {
  try {
    const value = localStorage.getItem('veyrnox_social_cinema');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}
