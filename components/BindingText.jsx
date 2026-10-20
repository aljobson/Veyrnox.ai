'use client';
import { createElement, Fragment } from 'react';
import { useI18n } from './I18nProvider';
import { BINDINGS, LEGAL_CHROME } from '../lib/i18n/legal/binding.mjs';
import { localeInfo } from '../lib/i18n/locales.mjs';
import { richParts, translator } from '../lib/i18n/translate.mjs';

// The original English element (including its lang/dir and event handlers) is
// supplied by the caller. No consent state or request/version data lives here.
export default function BindingText({ id, values = {}, slots = {}, children }) {
  const { locale } = useI18n();
  if (locale === 'en') return children;
  const messages = BINDINGS[locale];
  const chrome = LEGAL_CHROME[locale];
  const info = localeInfo(locale);
  const translated = richParts(messages[id]).map((part, index) => {
    if (typeof part === 'string') {
      if (locale !== 'ar') return part;
      return part.split(/(\d+(?:[.,]\d+)*(?:%)?)/g).map((value, n) =>
        /^\d/.test(value) ? <bdi dir="ltr" key={`${index}-${n}`}>{value}</bdi> : value);
    }
    const value = part.slot === 'interval' ? messages[`interval.${values.interval}`] : slots[part.slot] ?? values[part.slot];
    return createElement(Fragment, { key: index },
      part.slot === 'interval' || slots[part.slot] ? value : <bdi dir="ltr">{value}</bdi>);
  });
  return <span className="block min-w-0">
    {children}
    <span lang={info.hreflang} dir={info.dir} data-binding-translation={id} className="mt-3 block border-s-2 border-vx-border ps-3 text-start">
      <strong className="block">{chrome.translation}</strong>
      <span className="mt-1 block">{translated}</span>
      <span className="mt-2 block text-xs text-vx-fg-muted">{chrome.notice}</span>
      <strong className="mt-2 block">{chrome.agree}</strong>
    </span>
  </span>;
}

export function BindingPolicyLink({ policy }) {
  const { locale, href } = useI18n();
  const c = translator(locale, BINDINGS[locale]);
  const labels = { aup: c('policy.aup'), 'cinema-content': c('policy.cinema-content') };
  return <a href={href(`/legal/${policy}`)} target="_blank" rel="noreferrer" className="font-semibold underline">{labels[policy]}</a>;
}
