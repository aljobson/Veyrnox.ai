// Message lookup (ADR-0106). Pure and synchronous: no request state in here,
// so the same code runs in server components, client components and tests.
import en from './messages/en.mjs';
import es from './messages/es.mjs';
import zh from './messages/zh.mjs';
import hi from './messages/hi.mjs';
import ar from './messages/ar.mjs';
import fr from './messages/fr.mjs';
import pt from './messages/pt.mjs';
import ru from './messages/ru.mjs';
import ja from './messages/ja.mjs';
import de from './messages/de.mjs';
import ko from './messages/ko.mjs';
import { DEFAULT_LOCALE, isLocale } from './locales.mjs';

export const CATALOGS = { en, es, zh, hi, ar, fr, pt, ru, ja, de, ko };

const SLOT = /\{([a-zA-Z0-9_]+)\}/g;

/** The messages for one language, English filling any gap. */
export function messagesFor(locale) {
  const code = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return code === DEFAULT_LOCALE ? en : { ...en, ...CATALOGS[code] };
}

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

/** A translator bound to one language's messages. */
export function translator(locale) {
  const messages = messagesFor(locale);
  const t = (key, vars) => translate(messages, key, vars);
  // Nav and footer lists carry their English label; this finds its translation
  // and falls back to the label itself, so an unlisted label still renders.
  t.label = (label) => (typeof messages[`label.${label}`] === 'string' ? messages[`label.${label}`] : label);
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
