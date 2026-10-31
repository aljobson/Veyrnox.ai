// Every public catalog, statically imported: for the catalog checks, the review
// export/import scripts and tests. Product code never imports this file; the
// client bundle carries English only (lib/i18n/translate.mjs) and the server
// loads one language per request (lib/i18n/publicMessages.mjs).
import { ENGLISH, withPresets } from './translate.mjs';
import { DEFAULT_LOCALE, isLocale } from './locales.mjs';
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
import esNeeds from './messages/presets/es/needs.mjs';
import esSteps from './messages/presets/es/steps.mjs';
import zhNeeds from './messages/presets/zh/needs.mjs';
import zhSteps from './messages/presets/zh/steps.mjs';
import hiNeeds from './messages/presets/hi/needs.mjs';
import hiSteps from './messages/presets/hi/steps.mjs';
import arNeeds from './messages/presets/ar/needs.mjs';
import arSteps from './messages/presets/ar/steps.mjs';
import frNeeds from './messages/presets/fr/needs.mjs';
import frSteps from './messages/presets/fr/steps.mjs';
import ptNeeds from './messages/presets/pt/needs.mjs';
import ptSteps from './messages/presets/pt/steps.mjs';
import ruNeeds from './messages/presets/ru/needs.mjs';
import ruSteps from './messages/presets/ru/steps.mjs';
import jaNeeds from './messages/presets/ja/needs.mjs';
import jaSteps from './messages/presets/ja/steps.mjs';
import deNeeds from './messages/presets/de/needs.mjs';
import deSteps from './messages/presets/de/steps.mjs';
import koNeeds from './messages/presets/ko/needs.mjs';
import koSteps from './messages/presets/ko/steps.mjs';

export const CATALOGS = {
  en: ENGLISH,
  es: withPresets(es, esNeeds, esSteps),
  zh: withPresets(zh, zhNeeds, zhSteps),
  hi: withPresets(hi, hiNeeds, hiSteps),
  ar: withPresets(ar, arNeeds, arSteps),
  fr: withPresets(fr, frNeeds, frSteps),
  pt: withPresets(pt, ptNeeds, ptSteps),
  ru: withPresets(ru, ruNeeds, ruSteps),
  ja: withPresets(ja, jaNeeds, jaSteps),
  de: withPresets(de, deNeeds, deSteps),
  ko: withPresets(ko, koNeeds, koSteps),
};

/** The messages for one language, English filling any gap. */
export function messagesFor(locale) {
  const code = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return code === DEFAULT_LOCALE ? ENGLISH : { ...ENGLISH, ...CATALOGS[code] };
}
