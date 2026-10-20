import { createElement, Fragment } from 'react';
import { getLocale } from '../../../lib/i18n/server';
import { legalDocument } from '../../../lib/i18n/legal/catalogs.mjs';
import { pageAlternates } from '../../../lib/i18n/metadata.mjs';
import { localizedHref, localeTag, isLocalizedPath } from '../../../lib/i18n/locales.mjs';
import { rich } from '../../../lib/i18n/rich';
import { fill, translator } from '../../../lib/i18n/translate.mjs';
import { LegalPage, ENTITY } from './Legal';

// The English branch emits the original strings without added numeric wrappers.
export function legalText(text, locale) {
  if (locale !== 'ar') return text;
  return text.split(/(\d+(?:[.,:/+-]\d+)*(?:%|\+)?)/g).map((part, index) =>
    /^\d/.test(part) ? <bdi dir="ltr" key={index}>{part}</bdi> : part);
}

export function LegalBlocks({ blocks, messages, locale }) {
  function render(block, key) {
    const attrs = Object.fromEntries(Object.entries(block.attrs || {}).map(([name, value]) => [name,
      name === 'href' ? localizedHref(locale, fill(value, ENTITY)) : value]));
    if (block.children) return createElement(block.tag, { ...attrs, key }, block.children.map(render));
    const slots = Object.fromEntries(Object.entries(block.slots || {}).map(([id, child]) => [id, render(child, id)]));
    for (const [id, value] of Object.entries(ENTITY)) slots[id] = legalText(value, locale);
    // rich() keeps inline links/emphasis as elements, never interpreted HTML.
    const text = messages[block.key];
    const parts = rich(text, slots);
    if (locale === 'ar') return createElement(block.tag, { ...attrs, key }, parts.map((part, index) =>
      createElement(Fragment, { key: index }, typeof part.props.children === 'string' ? legalText(part.props.children, locale) : part)));
    return createElement(block.tag, { ...attrs, key }, parts);
  }
  return blocks.map(render);
}

export async function legalMetadata(document) {
  const locale = await getLocale();
  const { messages } = await legalDocument(locale, document);
  return { title: messages.title, description: messages.description, alternates: isLocalizedPath(`/legal/${document}`) ? pageAlternates(locale, `/legal/${document}`) : { canonical: `/legal/${document}` } };
}

export default async function LegalDocument({ document }) {
  const locale = await getLocale();
  const data = await legalDocument(locale, document);
  const updated = locale === 'en' ? data.updated : new Intl.DateTimeFormat(localeTag(locale), {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', numberingSystem: 'latn',
  }).format(new Date(`${data.updated} 00:00:00 GMT`));
  return <LegalPage title={data.messages.title} updated={updated} locale={locale} document={document} c={translator(locale, data.chrome)}>
    <LegalBlocks blocks={data.blocks} messages={data.messages} locale={locale} />
  </LegalPage>;
}
