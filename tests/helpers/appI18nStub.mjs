import * as translate from '../../lib/i18n/translate.mjs';
import * as locales from '../../lib/i18n/locales.mjs';
import { appMessagesFor } from '../../lib/i18n/appMessages.mjs';
const t = translate.translator('en', await appMessagesFor('en'));
export const englishAppImports = {
  '../../../../components/I18nProvider': { useI18n: () => ({ t, locale: 'en' }) },
  '../../../../lib/i18n/translate.mjs': translate,
  '../../../../lib/i18n/locales.mjs': locales,
};
