'use client';
import { Children, cloneElement, createElement, Fragment, isValidElement, useId } from 'react';
import { useI18n } from './I18nProvider';
import { BINDINGS, LEGAL_CHROME } from '../lib/i18n/legal/binding.mjs';
import { localeInfo } from '../lib/i18n/locales.mjs';
import { richParts, translator } from '../lib/i18n/translate.mjs';

// The caller supplies the original label. Only the checkbox's description is
// extended; the translated explanation is outside the clickable label.
export default function BindingText({ id, values = {}, slots = {}, children }) {
  const { locale } = useI18n();
  const descriptionId = useId();
  if (locale === 'en') return children;
  function describe(node) {
    if (!isValidElement(node)) return node;
    if (node.type === 'input' && node.props.type === 'checkbox') {
      return cloneElement(node, { 'aria-describedby': [node.props['aria-describedby'], descriptionId].filter(Boolean).join(' ') });
    }
    return node.props.children === undefined ? node : cloneElement(node, {}, Children.map(node.props.children, describe));
  }
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
  return <>
    {Children.map(children, describe)}
    <span id={descriptionId} lang={info.hreflang} dir={info.dir} data-binding-translation={id} className="mt-3 block border-s-2 border-vx-border ps-3 text-start">
      <strong className="block">{chrome.translation}</strong>
      <span className="mt-1 block">{translated}</span>
      <span className="mt-2 block text-xs text-vx-fg-muted">{chrome.notice}</span>
      <strong className="mt-2 block">{chrome.agree}</strong>
    </span>
  </>;
}

export function BindingPolicyLink({ policy }) {
  const { locale, href } = useI18n();
  const c = translator(locale, BINDINGS[locale]);
  const labels = { aup: c('policy.aup'), 'cinema-content': c('policy.cinema-content') };
  return <a href={href(`/legal/${policy}`)} target="_blank" rel="noreferrer" className="font-semibold underline">{labels[policy]}</a>;
}
