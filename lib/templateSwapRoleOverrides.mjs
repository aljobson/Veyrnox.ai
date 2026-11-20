import { normaliseSwapRole } from './templateSwapClipRoles.mjs';

// One-photo swap roles corrected by eye (ADR-0351 amendment 16, 2026-11-20). The importer copied each clip's role from its source
// prompt, which describes the creator's reference images, not the clip; the pinned R2 manifest cannot change, so the reviewed
// wording lives here. Each entry names the person a customer expects to become, as they look in the uploaded clip (five frames
// read per clip). An id not listed keeps its manifest role. Gate, prompt, job identity and replay all read effectiveSwapRole.
export const TEMPLATE_SWAP_ROLE_OVERRIDES = Object.freeze({
  'community-broomstick-flight-swap': 'the woman in the black dress holding the broom',
  'community-nightclub-dj-set': 'the older woman DJ in the red fur coat',
  'beyond-gravity': 'the man in the dark suit running across the water',
  'community-action-hero-swap': 'the woman in the fur coat sitting on the couch',
  'community-ballroom-dance-switch': 'the man in the dark suit dancing in the centre',
  'community-cafeteria-hero-recast': 'the young man in the white shirt at the table',
  'community-cinematic-face-swap': 'the bearded man in the black shirt',
  'community-cliffside-character-swap': 'the woman in the fur jacket dancing',
  'community-flying-cake-ride': 'the man in the passenger seat holding the cake',
  'community-industrial-cosplay-swap': 'the person in the steampunk costume and goggles',
  'community-industrial-street-flow': 'the man in sunglasses and the brown tracksuit',
  'community-money-mobile-recast': 'the older woman in sunglasses and the red fur coat',
  'community-office-orbit-sequence': 'the older woman in sunglasses and the red fur coat',
  'community-officer-traffic-stop': "the man in the blue uniform in the driver's seat",
  'community-pigeon-head-swap': 'the grey-haired man eating with the pigeons',
  'community-purple-suit-slam': 'the player in the purple suit',
  'community-restaurant-character-recast': 'the bearded man in the cap sitting at the table',
  'community-skyscraper-ledge-spin': 'the red-haired woman sitting on the ledge',
  'community-street-style-strut': 'the blonde woman in sunglasses and jeans',
  'community-urban-dance-recast': 'the woman with long hair in the blue jersey',
  'community-supercar-driver-swap': 'the man in the red t-shirt and cap driving',
});

/** The role the prompt and the composer use: the reviewed override when listed, else the manifest's own role. */
export function effectiveSwapRole(id, manifestRole, table = TEMPLATE_SWAP_ROLE_OVERRIDES) {
  return Object.hasOwn(table, id) ? normaliseSwapRole(table[id]) : normaliseSwapRole(manifestRole);
}
