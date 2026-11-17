import * as display from '../../app/veyrnox/_lib/music/beat/beatDisplay.mjs';
import * as actions from '../../app/veyrnox/_lib/music/beat/beatActionLabels.mjs';
import * as labels from '../../app/veyrnox/_lib/music/beat/beatLabels.mjs';
import * as errors from '../../app/veyrnox/_lib/music/beat/beatErrors.mjs';
import messages from '../../lib/i18n/messages/app/en.mjs';
import * as translate from '../../lib/i18n/translate.mjs';
import { translator } from '../../lib/i18n/translate.mjs';
const english = translator('en', messages);
export const englishBeatImports = {
  '../../../_lib/music/beat/beatDisplay.mjs': display,
  '../../../_lib/music/beat/beatActionLabels.mjs': actions,
  '../../../_lib/music/beat/beatLabels.mjs': labels,
  '../../../_lib/music/beat/beatErrors.mjs': errors,
  '../../../../../lib/i18n/translate.mjs': translate,
  '../../../../../components/I18nProvider': { useI18n: () => ({ locale: 'en', t: english }) },
};
