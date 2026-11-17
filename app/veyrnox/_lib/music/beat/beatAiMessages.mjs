import messages from '../../../../../lib/i18n/messages/app/en/music-beat-ai.mjs';
import { translator } from '../../../../../lib/i18n/translate.mjs';
export const aiEnglish = translator('en', messages);
const byText = new Map(Object.entries(messages).map(([key, value]) => [value, key]));
const codes = Object.fromEntries(Object.keys(messages).map(key => [`ai-${key.split('.').at(-1)}`, key]));
export function aiFailure(id) {
  const code = `ai-${id}`;
  return Object.assign(new Error(aiEnglish(codes[code])), { code });
}
export function aiFailureText(error, t = aiEnglish) {
  return codes[error?.code] ? t(codes[error.code]) : '';
}
// Only canonical application copy enters here; provider messages are never passed through.
export function aiText(text, t = aiEnglish) {
  if (!text) return '';
  if (byText.has(text)) return t(byText.get(text));
  const retry = /^Too many requests\. Try again in (\d+) seconds\.$/.exec(text);
  if (retry) return t('app.music.beat.ai.a44', { n: retry[1] });
  const capacity = /^Generating adds two tracks\. This song has (\d+) of 16 — remove (one|two) first$/.exec(text);
  if (capacity) return t(capacity[2] === 'one' ? 'app.music.beat.ai.a42' : 'app.music.beat.ai.a43', { n: capacity[1] });
  return t('app.music.beat.ai.a40');
}
