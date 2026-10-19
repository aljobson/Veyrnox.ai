import { localeTag } from '../../../lib/i18n/locales.mjs';
// How long ago a job was submitted, as the Library card prints it.
export function formatWhen(ts, locale = 'en') {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (locale !== 'en') {
    const [value, unit] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute']
      : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day'];
    return new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'always', style: 'short' }).format(-value, unit);
  }
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
