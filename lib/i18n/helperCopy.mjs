import { helperDiagnostic } from '../helperMessages.mjs';
import { tOr } from './translate.mjs';
import { localeTag } from './locales.mjs';

/** Render a local helper diagnostic. Never use the result in data or comparisons. */
export function helperCopy(t, locale, value) {
  const diagnostic = helperDiagnostic(value);
  if (!diagnostic) return typeof value === 'string' ? value : '';
  const { code, message, params } = diagnostic;
  if (!code) return message;
  // Preserve the exact default, including spaces, punctuation and number syntax.
  if (locale === 'en') return message;
  const vars = { ...params };
  for (const key of ['reason', 'instructions', 'animation']) if (typeof vars[key] === 'string') vars[key] = helperCopy(t, locale, vars[key]);
  if (code === 'passport_summary' && params.details === 'No identity details saved yet.') vars.details = helperCopy(t, locale, params.details);
  for (const [key, raw] of Object.entries(vars)) {
    if (!/^(?:limit|value)/.test(key)) continue;
    const word = { four: 4, eight: 8 }[raw];
    const numeric = word ?? (typeof raw === 'number' ? raw : typeof raw === 'string' && /^−?\d+(?:[.,]\d+)*$/.test(raw) ? Number(raw.replaceAll(',', '').replace('−', '-')) : NaN);
    if (Number.isFinite(numeric)) vars[key] = new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 10 }).format(numeric);
  }
  if (code === 'clips_length') vars.value2 = tOr(t, `app.helpers.message.${params.value2}`, params.value2);
  if (code === 'too_many_clips') vars.value1 = tOr(t, `app.helpers.message.${params.value1}`, params.value1);
  const key = `app.helpers.message.${code}`;
  return typeof t.messages?.[key] === 'string' ? tOr(t, key, message, vars) : message;
}
