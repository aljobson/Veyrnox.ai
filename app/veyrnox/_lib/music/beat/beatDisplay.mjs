import details from '../../../../../lib/i18n/messages/app/en/music-beat-details.mjs';
import shared from '../../../../../lib/i18n/messages/app/en/music-beat-shared.mjs';
import part0 from '../../../../../lib/i18n/messages/app/en/music-beat-actions.mjs';
import part1 from '../../../../../lib/i18n/messages/app/en/music-beat-ai.mjs';
import part2 from '../../../../../lib/i18n/messages/app/en/music-beat-enums.mjs';
import part3 from '../../../../../lib/i18n/messages/app/en/music-beat-errors.mjs';
import part4 from '../../../../../lib/i18n/messages/app/en/music-beat-labels.mjs';
import part5 from '../../../../../lib/i18n/messages/app/en/music-beat-messages.mjs';
import part6 from '../../../../../lib/i18n/messages/app/en/music-beat-polish.mjs';
import part7 from '../../../../../lib/i18n/messages/app/en/music-beat-recovery.mjs';
import part8 from '../../../../../lib/i18n/messages/app/en/music-beat-seed.mjs';
import part9 from '../../../../../lib/i18n/messages/app/en/music-beat-status.mjs';
import part10 from '../../../../../lib/i18n/messages/app/en/music-beat-time.mjs';
import part11 from '../../../../../lib/i18n/messages/app/en/music-beat-ui-1.mjs';
import part12 from '../../../../../lib/i18n/messages/app/en/music-beat-ui-2.mjs';
import { translator } from '../../../../../lib/i18n/translate.mjs';
const messages = { ...details, ...shared, ...part0, ...part1, ...part2, ...part3, ...part4, ...part5, ...part6, ...part7, ...part8, ...part9, ...part10, ...part11, ...part12 };
export const beatEnglish = translator('en', messages);
const byText = new Map(Object.entries(messages).map(([key, value]) => [value, key]));
// Only controlled application messages use this adapter; user content never does.
export function beatText(value, t = beatEnglish) {
  const takeLimit = beatEnglish('app.music.beat.details.d27'), takeHelp = beatEnglish('app.music.beat.shared.takeLimitHelp');
  if (value === takeLimit + takeHelp) return t('app.music.beat.details.d27') + t('app.music.beat.shared.takeLimitHelp');
  return byText.has(value) ? t(byText.get(value)) : value;
}
