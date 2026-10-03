// The Cinema preview flag. '1' matches every other veyrnox_* preview flag;
// 'true' is the value the handoff doc gave out first, so it still works.
export function cinemaPreviewEnabled() {
  try {
    const value = localStorage.getItem('veyrnox_social_cinema');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}
