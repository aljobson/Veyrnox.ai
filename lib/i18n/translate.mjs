// Message lookup (ADR-0107). Pure and synchronous: no request state in here,
// so the same code runs in server components, client components and tests.
//
// Only the English source is imported here. This module reaches the client
// bundle through components/I18nProvider.jsx, so the other ten catalogs must
// not: the server loads the request's language (lib/i18n/publicMessages.mjs)
// and passes it down as props. Scripts and tests that need every catalog use
// lib/i18n/catalogs.mjs.
import en from './messages/en.mjs';
import { localeTag } from './locales.mjs';
import enNeeds from './messages/presets/en/needs.mjs';
import enSteps from './messages/presets/en/steps.mjs';

// Preset recipe copy is merged here, not inside the catalog files: apps/mobile/scripts/sync-web-i18n.mjs
// reads those files as import-free text.
export const withPresets = (catalog, needs, steps) => ({ ...catalog, ...needs, ...steps });

/** The English public catalog: the source every other language mirrors and the fallback for any gap. */
export const ENGLISH = withPresets(en, enNeeds, enSteps);

const SLOT = /\{([a-zA-Z0-9_]+)\}/g;

/** Fill {slots} in a string. A slot with no value is left as written. */
export function fill(text, vars) {
  if (!vars) return text;
  return text.replace(SLOT, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/** t(messages, 'home.hero.title', { n: 3 }) */
export function translate(messages, key, vars) {
  const text = messages[key];
  return fill(typeof text === 'string' ? text : key, vars);
}

/** Dynamic catalog lookup: preserve server/user text when a key is unknown. */
export function tOr(t, key, fallback, vars) {
  return typeof t.messages?.[key] === 'string' ? t(key, vars) : fill(fallback, vars);
}

/** Select the locale's plural category, with .other for unsupported forms. */
export function pluralKey(t, locale, key, count) {
  const category = new Intl.PluralRules(localeTag(locale, 'en')).select(count);
  const candidate = `${key}.${category}`;
  return typeof t.messages[candidate] === 'string' ? candidate : `${key}.other`;
}

/**
 * A translator bound to one language's messages. `messages` is the merged
 * catalog for `locale` (English filling any gap); without one, English.
 */
export function translator(locale, messages = ENGLISH) {
  const t = (key, vars) => translate(messages, key, vars);
  // Nav and footer lists carry their English label; this finds its translation
  // and falls back to the label itself, so an unlisted label still renders.
  t.label = (label) => tOr(t, `label.${label}`, label);
  t.messages = messages;
  return t;
}

/**
 * Split text with {slots} into strings and slot names, for a caller that
 * fills the slots with elements: ['Read our ', {slot:'privacy'}, ' and ', ...].
 */
export function richParts(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(SLOT)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ slot: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
