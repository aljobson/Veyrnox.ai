/** Visible playback wall time, not time spent on the watch page.
 * Keep fractions between beats; a delayed browser can send at most 60 seconds.
 * The server still enforces entitlement, per-account wall time and ceilings.
 */
export function createPlaybackMeter(now = () => performance.now()) {
  let playing = false;
  let visible = true;
  let last = now();
  let pending = 0;
  const accrue = () => {
    const next = now();
    if (playing && visible) pending = Math.min(60_000, pending + Math.max(0, next - last));
    last = next;
  };
  return {
    setPlaying(value) { accrue(); playing = value === true; },
    setVisible(value) { accrue(); visible = value === true; },
    isPlaying() { return playing && visible; },
    takeSeconds() {
      accrue();
      const seconds = Math.floor(pending / 1000);
      pending -= seconds * 1000;
      return seconds;
    },
  };
}
