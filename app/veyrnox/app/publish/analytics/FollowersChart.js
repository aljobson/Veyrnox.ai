'use client';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

const WIDTH = 800;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 12 };


/** Followers over time, one point per stored day. */
export function FollowersChart({ series, label: suppliedLabel }) {
  const { t, locale } = useI18n();
  const label = suppliedLabel ?? t('app.publish.analytics.followers');
  const whole = new Intl.NumberFormat(localeTag(locale));
  const day = value => formatDay(value, locale);
  if (series.length === 0) return <p className="text-sm text-vx-fg-muted">{t('app.publish.analytics.noNumbers', { label: label.toLowerCase() })}</p>;
  if (series.length === 1) {
    return <p className="text-sm text-vx-fg-muted">
      {t('app.publish.analytics.oneDay', { count: whole.format(series[0].followers), label: label.toLowerCase(), date: day(series[0].date) })}
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
      aria-label={t('app.publish.analytics.chartLabel', { label, firstCount: whole.format(first.followers), firstDate: day(first.date), lastCount: whole.format(last.followers), lastDate: day(last.date) })}
      className="w-full h-auto text-vx-accent"
    >
      <polygon points={area} fill="currentColor" opacity="0.12" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => (
        <circle key={series[i].date} cx={x} cy={y} r="3" fill="currentColor">
          <title>{`${day(series[i].date)}: ${whole.format(series[i].followers)}`}</title>
        </circle>
      ))}
    </svg>
    <figcaption className="flex justify-between text-xs text-vx-fg-muted mt-1">
      <span>{day(first.date)} · {whole.format(first.followers)}</span>
      <span>{day(last.date)} · {whole.format(last.followers)}</span>
    </figcaption>
  </figure>;
}

function formatDay(date, locale) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(localeTag(locale), { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
