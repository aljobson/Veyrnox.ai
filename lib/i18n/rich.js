import { createElement, Fragment } from 'react';
import { richParts } from './translate.mjs';

/**
 * Fill {slots} in a message with elements:
 *   rich(t('home.publish.p2'), { privacy: <a>..</a>, terms: <a>..</a> })
 * Word order stays the translator's; the caller only supplies the elements.
 */
export function rich(text, slots) {
  return richParts(text).map((part, i) => (
    typeof part === 'string'
      ? createElement(Fragment, { key: i }, part)
      : createElement(Fragment, { key: i }, slots[part.slot] ?? `{${part.slot}}`)
  ));
}
