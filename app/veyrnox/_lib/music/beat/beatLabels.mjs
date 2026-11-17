import messages from '../../../../../lib/i18n/messages/app/en/music-beat-enums.mjs';
import { translator } from '../../../../../lib/i18n/translate.mjs';
const english = translator('en', messages);
const keys = new Map(Object.entries(messages).map(([key, value]) => [value, key]));
// Only fixed control enums enter this lookup, never user titles or stored track names.
export function beatLabel(value, t = english) { return keys.has(value) ? t(keys.get(value)) : value; }
