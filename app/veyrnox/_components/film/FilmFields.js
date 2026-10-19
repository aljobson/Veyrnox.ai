'use client';
import { tOr, pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useId } from 'react';
import englishFields from '../../../../lib/i18n/messages/app/en/film-setup.mjs';
export const fieldClass = 'mt-2 w-full rounded-xl border border-vx-field bg-vx-panel px-3 py-2 text-sm text-vx-fg focus:border-vx-accent focus:outline-none';
export function FilmField({ label, value, onChange, multiline = false, hint, ...props }) {
  const { t } = useI18n();
  const displayLabel = tOr(t, `app.film.field.${label}`, label);
  const Tag = multiline ? 'textarea' : 'input';
  const hintId=useId();
  return <label className="block text-sm font-semibold">{displayLabel}
    {hint && <span id={hintId} className="mt-1 block text-xs font-normal text-vx-fg-muted">{hint}</span>}
    <Tag aria-label={displayLabel} aria-describedby={hint?hintId:undefined} className={fieldClass} value={value} onChange={e => onChange(e.target.value)} rows={multiline ? 4 : undefined} maxLength={multiline ? 24000 : 2000} {...props} />
  </label>;
}
export function FilmSelect({ label, value, onChange, options, ...props }) {
  return <label className="block text-sm font-semibold">{label}<select aria-label={label} className={fieldClass} value={value} onChange={e => onChange(e.target.value)} {...props}>
    {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select></label>;
}
export function FilmIssues({ issues }) {
  const { t, locale } = useI18n();
  if (!issues.length) return <p role="status" className="mt-5 text-sm text-vx-accent">{t("app.film.issues.ready")}</p>;
  return <div className="mt-5 rounded-xl border border-vx-border p-4 text-sm" role="status"><p className="font-semibold">{t("app.film.issues.before")}</p><ul className="mt-2 list-disc space-y-1 ps-5">{issues.slice(0, 12).map((s,i) => <li key={i}>{filmIssue(t, locale, s)}</li>)}</ul>{issues.length > 12 && <p className="mt-2">{t(pluralKey(t, locale, 'app.film.issues.more', issues.length - 12), { count: locale === 'en' ? issues.length - 12 : (issues.length - 12).toLocaleString(localeTag(locale)) })}</p>}</div>;
}

// Match the existing helper's complete templates; captured names remain user content.
const issuePatterns = Object.entries(englishFields).filter(([key]) => key.startsWith('app.film.issue.') && !key.endsWith('.valid')).map(([key, text]) => {
  const slots = [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '(.+)');
  return { key, slots, pattern: new RegExp(`^${escaped}$`) };
});
export function filmIssue(t, locale, message) {
  for (const { key, slots, pattern } of issuePatterns) {
    const match = pattern.exec(message);
    if (!match) continue;
    const vars = Object.fromEntries(slots.map((slot, i) => [slot, match[i + 1]]));
    if (vars.label) {
      const split = vars.label.lastIndexOf(': ');
      const prefix = split < 0 ? '' : vars.label.slice(0, split + 2);
      const label = split < 0 ? vars.label : vars.label.slice(split + 2);
      vars.label = prefix + tOr(t, `app.film.field.${label}`, label);
    }
    if (vars.type) vars.type = tOr(t, `app.film.assetType.${vars.type}`, vars.type);
    if (vars.range === 'valid') vars.range = t('app.film.issue.valid');
    else if (vars.range && locale !== 'en') vars.range = vars.range.replace(/\d+/g, number => Number(number).toLocaleString(localeTag(locale)));
    return tOr(t, key, message, vars);
  }
  // Stage diagnostics prefix a shot ID to the same complete issue sentence.
  const split = message.indexOf(': ');
  if (split >= 0) return message.slice(0, split + 2) + filmIssue(t, locale, message.slice(split + 2));
  return message;
}
