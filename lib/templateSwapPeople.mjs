import { appRuntimeFlag, templateSwapSwitchOn } from './appRuntime.js';
import { normaliseSwapRole } from './templateSwapClipRoles.mjs';

// Two-person swap templates (ADR-0351 amendment 14). The pinned R2 manifest carries ONE role per clip, so the two roles of a
// two-person clip live here, reviewed by hand. A clip is two-person only when it is listed AND the runtime key is on; any other
// clip keeps the one-person path. Order is fixed: role 1 = @Element1 = the first photo, role 2 = @Element2 = the second.
// Each pair describes the two people AS THEY APPEAR IN THE CLIP (eye-checked against the uploaded clips, 2026-11-20). The
// source prompts' own words name the creator's reference images ("the green character"), which do not match the clip, and
// O1 needs the clip. Clips whose second person is barely in frame, an object, an animal or a room stay one-person; the ~45
// clips whose source slots both read "the main character" need an eye-checked pair before they are listed.
export const TEMPLATE_SWAP_PEOPLE_ROLES = Object.freeze({
  'basketball-3': Object.freeze(['the girl in the blue headscarf holding the basketball', 'the woman in the long green dress']),
  'community-double-character-swap': Object.freeze(['the grey-skinned man in the brown vest in the foreground', 'the blonde man in the black jacket in the background']),
  'community-firelit-combat-duel': Object.freeze(['the fighter in black tactical gear', 'the bearded fighter in the khaki shirt']),
  'community-elevator-dance-swap': Object.freeze(['the man in the grey uniform standing and dancing', 'the man in camouflage lying on the floor']),
  'community-streetball-rivalry-swaps': Object.freeze(['the player in the grey shirt who dunks the ball', 'the defender in the red tracksuit']),
});

/** Own runtime key inside APP_RUNTIME_FLAGS (no new binding). Absent = off. Needs the swap switch too. */
export const templateSwapPeopleOn = (env = process.env) => templateSwapSwitchOn(env) && appRuntimeFlag('templateSwapPeople', env);

/** The two normalised roles for `id` when two-person is on and the pair is usable; otherwise null (one-person path). */
export function templateSwapPeopleRoles(id, env = process.env, table = TEMPLATE_SWAP_PEOPLE_ROLES) {
  if (!templateSwapPeopleOn(env) || !Object.hasOwn(table, id)) return null;
  const pair = table[id];
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const roles = pair.map(normaliseSwapRole);
  return roles[0] && roles[1] && roles[0] !== roles[1] ? roles : null;
}
