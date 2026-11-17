import details from '../../../../../lib/i18n/messages/app/en/music-beat-details.mjs';
import { beatEnglish } from './beatDisplay.mjs';
import recovery from '../../../../../lib/i18n/messages/app/en/music-beat-recovery.mjs';
import baseMessages from '../../../../../lib/i18n/messages/app/en/music-beat-errors.mjs';
import { translator } from '../../../../../lib/i18n/translate.mjs';
const messages = { ...baseMessages, ...recovery, ...details, 'app.music.beat.ui.this.device.has.50.beats.delete.one.to.make.room': beatEnglish('app.music.beat.ui.this.device.has.50.beats.delete.one.to.make.room') };
const english = translator('en', messages);
const keys = Object.fromEntries(Object.keys(messages).map(key => [key.includes('.recovery.') ? `recovery-${key.split('.').at(-1)}` : key.includes('.details.') ? `details-${key.split('.').at(-1)}` : key.split('.').at(-1), key]));
keys['recovery-r87'] = 'app.music.beat.recovery.missingSounds.one';
keys['recovery-r88'] = 'app.music.beat.recovery.missingSounds.other';
keys['device-limit'] = 'app.music.beat.ui.this.device.has.50.beats.delete.one.to.make.room';
// Only application-owned codes select copy. Never expose browser, storage or HTTP text.
export function beatErrorMessage(error, fallback = 'playback', t = english) {
  const code = error?.displayCode || error?.code;
  const key = keys[({ asset_held: 'asset-held', asset_unconfirmed: 'asset-unconfirmed' })[code] || code];
  return t(Object.hasOwn(messages, key) ? key : keys[fallback], error?.params);
}
export function beatFailure(code, params) {
  return Object.assign(new Error(english(keys[code], params)), { code, displayCode: code, params });
}
