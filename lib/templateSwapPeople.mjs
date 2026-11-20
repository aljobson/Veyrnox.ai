import { appRuntimeFlag, templateSwapSwitchOn } from './appRuntime.js';
import { normaliseSwapRole } from './templateSwapClipRoles.mjs';

// Two-person swap templates (ADR-0351 amendment 12). The pinned R2 manifest carries ONE role per clip, so the two roles of a
// two-person clip live here, reviewed by hand. A clip is two-person only when it is listed AND the runtime key is on; any other
// clip keeps the one-person path. Roles are the source prompt's own words for image slot 1 and slot 2 (@Element1, @Element2).
// First wave: both slots name a distinct person. The ~45 clips whose two slots both read "the main character" need an
// owner-written pair first (the model cannot tell two identical roles apart), and clips whose second slot is an object, an animal
// or a room stay one-person.
export const TEMPLATE_SWAP_PEOPLE_ROLES = Object.freeze({
  'basketball-3': Object.freeze(['the green character', 'the red character']),
  'community-double-character-swap': Object.freeze(['the blonde man in the black suit', 'the dark-skinned man in the blue suit']),
  'community-firelit-combat-duel': Object.freeze(['the fighter on the left', 'the fighter on the right']),
  'community-cliffside-rescue-hero': Object.freeze(['the person hanging from the rocks and being rescued', 'the suited rescuer']),
  'community-elevator-dance-swap': Object.freeze(['the man standing up and dancing', 'the character laying on the ground']),
  'community-streetball-rivalry-swaps': Object.freeze(['the main character', 'the opponent']),
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
