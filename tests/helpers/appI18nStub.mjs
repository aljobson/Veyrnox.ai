import * as helperDisplay from '../../lib/i18n/helperCopy.mjs';
import * as translate from '../../lib/i18n/translate.mjs';
import * as locales from '../../lib/i18n/locales.mjs';
import { appMessagesFor } from '../../lib/i18n/appMessages.mjs';
const t = translate.translator('en', { ...translate.messagesFor('en'), ...await appMessagesFor('en') });
export const englishAppImports = {
  '../../../../lib/i18n/helperCopy.mjs': helperDisplay,
  '../../../../components/I18nProvider': { useI18n: () => ({ t, locale: 'en' }) },
  '../../../../lib/i18n/translate.mjs': translate,
  '../../../../lib/i18n/locales.mjs': locales,
};
