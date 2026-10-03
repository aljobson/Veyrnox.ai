'use client';

const WIDTH = 800;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 12 };
const whole = new Intl.NumberFormat();

/** Followers over time, one point per stored day. */
export function FollowersChart({ series, label = 'Followers' }) {
  if (series.length === 0) return <p className="text-sm text-vx-fg-muted">No {label.toLowerCase()} numbers in this period.</p>;
  if (series.length === 1) {
    return <p className="text-sm text-vx-fg-muted">
      {whole.format(series[0].followers)} {label.toLowerCase()} on {formatDay(series[0].date)}. The trend appears once there are two days of numbers.
    </p>;
  }

  const values = series.map((p) => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const points = series.map((p, i) => [
    PAD.left + (i / (series.length - 1)) * innerWidth,
    PAD.top + (1 - (p.followers - min) / span) * innerHeight,
  ]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const baseline = PAD.top + innerHeight;
  const area = `${PAD.left},${baseline} ${line} ${PAD.left + innerWidth},${baseline}`;
  const first = series[0];
  const last = series[series.length - 1];

  return <figure>
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${label} from ${whole.format(first.followers)} on ${formatDay(first.date)} to ${whole.format(last.followers)} on ${formatDay(last.date)}`}
      className="w-full h-auto text-vx-accent"
    >
      <polygon points={area} fill="currentColor" opacity="0.12" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => (
        <circle key={series[i].date} cx={x} cy={y} r="3" fill="currentColor">
          <title>{`${formatDay(series[i].date)}: ${whole.format(series[i].followers)}`}</title>
        </circle>
      ))}
    </svg>
    <figcaption className="flex justify-between text-xs text-vx-fg-muted mt-1">
      <span>{formatDay(first.date)} · {whole.format(first.followers)}</span>
      <span>{formatDay(last.date)} · {whole.format(last.followers)}</span>
    </figcaption>
  </figure>;
}

function formatDay(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
