/** Conservative full-second timeline coverage. Seeking, hidden/paused media and
 * implausible jumps contribute nothing; repeated ranges are unioned in the DB. */
export function createWatchCoverage(now = () => performance.now()) {
  let prior = null,
    anchor = null,
    ranges = [],
    seconds = 0;
  return {
    sample(position, playing) {
      const time = now();
      if (
        prior &&
        playing &&
        prior.playing &&
        Number.isFinite(position) &&
        position >= 0
      ) {
        const elapsed = Math.max(0, (time - prior.time) / 1000),
          delta = position - prior.position;
        if (delta > 0 && delta <= elapsed * 1.25 + 0.5) {
          const from = anchor ?? Math.ceil(prior.position),
            to = Math.floor(position);
          if (
            to > from &&
            to <= 600 &&
            seconds + to - from <= 60 &&
            ranges.length < 60
          ) {
            ranges.push([from, to]);
            seconds += to - from;
            anchor = to;
          }
        } else anchor = Math.ceil(position);
      } else anchor = Number.isFinite(position) ? Math.ceil(position) : null;
      prior = Number.isFinite(position) ? { position, time, playing } : null;
    },
    reset() {
      prior = null;
      anchor = null;
    },
    take() {
      if (!seconds) return null;
      const result = { seconds, ranges };
      ranges = [];
      seconds = 0;
      return result;
    },
  };
}
