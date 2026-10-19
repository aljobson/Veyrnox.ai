import { HELPER_MESSAGES } from './helperMessageDefinitions.mjs';

const fill = (text, params) => text.replace(/\{(\w+)\}/g, (slot, name) => Object.hasOwn(params, name) ? String(params[name]) : slot);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(HELPER_MESSAGES).map(([code, definition]) => {
  const names = [...definition.english.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
  const parts = definition.english.split(/\{\w+\}/g);
  return { code, definition, names, pattern: new RegExp(`^${parts.map(escape).join('([\\s\\S]*?)')}$`) };
});

/** English compatibility interface for existing validators and persisted metadata. */
export function helperEnglish(code, params = {}) {
  return fill(HELPER_MESSAGES[code].english, params);
}

/** Pure diagnostic interface: English plus a stable code and interpolation values.
 * Old validators and Error.message consumers keep their string contract. Their
 * diagnostic adapters use this interface before handing a result to the UI.
 * Matching is against source English only, never a translation or user locale.
 */
export function helperDiagnostic(value) {
  if (value && typeof value === 'object' && Object.hasOwn(HELPER_MESSAGES, value.code)) return value;
  const message = typeof value === 'string' ? value : value?.message;
  if (!message) return null;
  for (const { code, definition, names, pattern } of patterns) {
    const match = pattern.exec(message);
    if (match) return { code, message, params: { ...definition.defaults, ...Object.fromEntries(names.map((name, i) => [name, match[i + 1]])) } };
  }
  return { code: null, message, params: {} };
}

/** A source can emit this descriptor directly without looking up a locale. */
export function helperMessage(code, params = {}) {
  const definition = HELPER_MESSAGES[code];
  return { code, message: helperEnglish(code, params), params: { ...definition.defaults, ...params } };
}
