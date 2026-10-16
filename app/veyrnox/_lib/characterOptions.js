// Saved passports retain their original option keys; only the displayed wording changes.
const LABELS = {
  gender: { Female: 'Woman', Male: 'Man' },
  ethnicity_origin_base: { Asian: 'East Asian', Mixed: 'Multiracial' },
  body_type: { 'Very Skinny': 'Very slender', Skinny: 'Slender', Lanky: 'Long-limbed', Compact: 'Compact build',
    'Hyper-Muscular': 'Very muscular', Pear: 'Wider hips', 'Inverted Triangle': 'Broader shoulders', Barrel: 'Rounded torso',
    Heavy: 'Broad build', Fat: 'Full-bodied' },
  proportions: { Natural: 'Balanced proportions', 'Tiny Torso': 'Short torso', 'Huge Hands': 'Large hands',
    'Tiny Hands': 'Small hands', 'No Visible Neck': 'Short neck silhouette' },
  head_shape: { 'Perfect Round': 'Round', 'Tiny Head': 'Small head' },
  eye_color: { 'Blind / Empty': 'Pupil-free white' },
  eyes_details: { 'Blind Eye': 'Cloudy eye' },
  mouth: { 'Unique Teeth': 'Distinctive teeth', 'No Teeth': 'Teeth not visible' },
  skin_conditions: { Burns: 'Burn scars', Wrinkled: 'Fine lines', 'Cracked Skin': 'Dry skin texture' },
  left_arm: { Normal: 'Biological', 'Cute Prosthetic': 'Decorated prosthetic', None: 'Not present' },
  right_arm: { Normal: 'Biological', 'Cute Prosthetic': 'Decorated prosthetic', None: 'Not present' },
  left_leg: { Normal: 'Biological', 'Cute Prosthetic': 'Decorated prosthetic', None: 'Not present' },
  right_leg: { Normal: 'Biological', 'Cute Prosthetic': 'Decorated prosthetic', None: 'Not present' },
};

export function characterOptionLabel(groupId, value) {
  const labels = Object.hasOwn(LABELS, groupId) ? LABELS[groupId] : null;
  return labels && Object.hasOwn(labels, value) ? labels[value] : value;
}

// An explicit choice on one side removes the pick on the other that it would
// contradict. A side without `values` matches any pick in its group.
const EXCLUSIVE_PAIRS = [
  [{ key: 'brows' }, { key: 'face_features', values: ['Tiny Brows', 'One Brow'] }],
  [
    { key: 'everyday_accessories', values: ['Glasses', 'Round Glasses', 'Sunglasses'] },
    { key: 'accessories', values: ['Tiny Sunglasses', 'Tiny Monocle'] },
  ],
];

function sideMatches(side, key, value) {
  return side.key === key && Boolean(value) && (!side.values || side.values.includes(value));
}

export function changeCharacterPick(picks, key, value) {
  const next = { ...picks };
  if (value) next[key] = value; else delete next[key];
  for (const [a, b] of EXCLUSIVE_PAIRS) {
    if (sideMatches(a, key, value) && sideMatches(b, b.key, next[b.key])) delete next[b.key];
    if (sideMatches(b, key, value) && sideMatches(a, a.key, next[a.key])) delete next[a.key];
  }
  if (key === 'hand_size' && value && ['Huge Hands', 'Tiny Hands'].includes(next.proportions)) delete next.proportions;
  if (key === 'proportions' && ['Huge Hands', 'Tiny Hands'].includes(value)) delete next.hand_size;
  if (key === 'ear_size' && value && next.ears === 'No Ears') delete next.ears;
  if (key === 'ears' && value === 'No Ears') delete next.ear_size;
  if (key === 'mouth_size' && value && ['Small Mouth', 'Large Mouth'].includes(next.mouth)) delete next.mouth;
  if (key === 'mouth' && ['Small Mouth', 'Large Mouth'].includes(value)) delete next.mouth_size;
  if (key === 'head_size' && value && ['Tiny Head', 'Oversized Head'].includes(next.head_shape)) delete next.head_shape;
  if (key === 'head_shape' && ['Tiny Head', 'Oversized Head'].includes(value)) delete next.head_size;
  if (key === 'neck_size' && value && ['Long Neck', 'No Visible Neck'].includes(next.proportions)) delete next.proportions;
  if (key === 'proportions' && ['Long Neck', 'No Visible Neck'].includes(value)) delete next.neck_size;
  if (key === 'torso_size' && value) {
    if (['Tiny Torso', 'Long Torso'].includes(next.proportions)) delete next.proportions;
    if (['Long Torso', 'Long Legs'].includes(next.body_type)) delete next.body_type;
  }
  if ((key === 'proportions' && ['Tiny Torso', 'Long Torso'].includes(value))
    || (key === 'body_type' && ['Long Torso', 'Long Legs'].includes(value))) delete next.torso_size;
  return next;
}

export const CHARACTER_SIZE_GROUPS = [
  { id: 'torso_size', tab: 'Body', label: 'Torso Size', options: [
    ['Small', 'small torso relative to the head and limbs, compact chest-to-hip proportions'],
    ['Medium', 'medium-sized torso relative to the head and limbs, balanced chest-to-hip proportions'],
    ['Large', 'large torso relative to the head and limbs, broad extended chest-to-hip proportions'],
    ['Extra Large', 'extra-large torso relative to the head and limbs, dominant broad elongated chest-to-hip silhouette'],
  ] },
  { id: 'neck_size', tab: 'Body', label: 'Neck Size', options: [
    ['Small', 'small neck relative to the body'],
    ['Medium', 'medium-sized neck relative to the body'],
    ['Large', 'large neck relative to the body'],
    ['Extra Large', 'extra-large neck relative to the body'],
  ] },
  { id: 'arm_size', tab: 'Body', label: 'Arm Size', options: [
    ['Small', 'small arms relative to the body'],
    ['Medium', 'medium-sized arms relative to the body'],
    ['Large', 'large arms relative to the body'],
    ['Extra Large', 'extra-large arms relative to the body, arms fully visible in the frame'],
  ] },
  { id: 'leg_size', tab: 'Body', label: 'Leg Size', options: [
    ['Small', 'small legs relative to the body'],
    ['Medium', 'medium-sized legs relative to the body'],
    ['Large', 'large legs relative to the body'],
    ['Extra Large', 'extra-large legs relative to the body, legs fully visible in the frame'],
  ] },
  { id: 'head_size', tab: 'Face', label: 'Head Size', options: [
    ['Small', 'small head relative to the body'],
    ['Medium', 'medium-sized head relative to the body'],
    ['Large', 'large head relative to the body'],
    ['Extra Large', 'extra-large head relative to the body, entire head fully visible in the frame'],
  ] },
  { id: 'eye_size', tab: 'Face', label: 'Eye Size', options: [
    ['Small', 'small eyes relative to the face'],
    ['Medium', 'medium-sized eyes relative to the face'],
    ['Large', 'large eyes relative to the face'],
    ['Extra Large', 'extra-large eyes relative to the face, eyes clearly visible'],
  ] },
  { id: 'mouth_size', tab: 'Face', label: 'Mouth Size', options: [
    ['Small', 'small mouth relative to the face'],
    ['Medium', 'medium-sized mouth relative to the face'],
    ['Large', 'large mouth relative to the face'],
    ['Extra Large', 'extra-large mouth relative to the face, mouth clearly visible'],
  ] },
  { id: 'ear_size', tab: 'Face', label: 'Ear Size', options: [
    ['Small', 'small ears relative to the head'],
    ['Medium', 'medium-sized ears relative to the head'],
    ['Large', 'large ears relative to the head'],
    ['Extra Large', 'extra-large ears relative to the head, ears fully visible and unobscured'],
  ] },
  { id: 'nose_size', tab: 'Face', label: 'Nose Size', options: [
    ['Small', 'small nose relative to the face'],
    ['Medium', 'medium-sized nose relative to the face'],
    ['Large', 'large nose relative to the face'],
    ['Extra Large', 'extra-large nose relative to the face, nose clearly visible'],
  ] },
  { id: 'hand_size', tab: 'Body', label: 'Hand Size', options: [
    ['Small', 'small hands relative to the body'],
    ['Medium', 'medium-sized hands relative to the body'],
    ['Large', 'large hands relative to the body'],
    ['Extra Large', 'extra-large hands relative to the body, hands fully visible in the frame'],
  ] },
  { id: 'foot_size', tab: 'Body', label: 'Foot Size', options: [
    ['Small', 'small feet relative to the body, both feet fully visible in the frame'],
    ['Medium', 'medium-sized feet relative to the body, both feet fully visible in the frame'],
    ['Large', 'large feet relative to the body, both feet fully visible in the frame'],
    ['Extra Large', 'extra-large feet relative to the body, both feet fully visible in the frame'],
  ] },
];

// Everyday vocabulary added on top of the original builder. Every option stays
// an original, fictional adult: animal types are "anthropomorphic adult", nothing
// names a real person, brand or franchise, and Exaggeration styles proportions
// and styling only. New picks are additive, so saved passports keep working.

// New groups. `after` is the group each one is placed behind (tab order and
// prompt order); it is placement metadata and is not kept on the finished group.
export const CHARACTER_NEW_GROUPS = [
  { id: 'exaggeration', tab: 'Face', label: 'Exaggeration', after: 'character_type', options: [
    ['Natural', 'natural, believable feature proportions'],
    ['Bold', 'bold stylised exaggeration of the chosen features and silhouette'],
    ['Extreme', 'extreme caricature-scale exaggeration of the chosen features and silhouette'],
  ] },
  { id: 'brows', tab: 'Face', label: 'Eyebrows', after: 'head_shape', options: [
    ['Thick', 'thick strong eyebrows'],
    ['Thin', 'thin delicate eyebrows'],
    ['Arched', 'high arched eyebrows'],
    ['Straight', 'straight flat eyebrows'],
    ['Bushy', 'bushy untamed eyebrows'],
    ['Bleached', 'bleached, nearly invisible eyebrows'],
  ] },
  { id: 'nose_shape', tab: 'Face', label: 'Nose Shape', after: 'head_shape', options: [
    ['Straight', 'straight nose with a defined bridge'],
    ['Button', 'small rounded button nose'],
    ['Aquiline', 'aquiline nose with a high bridge'],
    ['Snub', 'softly upturned snub nose'],
    ['Wide', 'wide-bridged nose with softly flared nostrils'],
    ['Narrow', 'narrow slender nose'],
    ['Round Tip', 'nose with a soft rounded tip'],
  ] },
  { id: 'cheeks', tab: 'Face', label: 'Cheeks', after: 'head_shape', options: [
    ['High Cheekbones', 'high sculpted cheekbones'],
    ['Full Cheeks', 'full rounded cheeks'],
    ['Dimples', 'visible dimples'],
    ['Hollow Cheeks', 'hollow angular cheeks'],
  ] },
  { id: 'lips', tab: 'Face', label: 'Lips', after: 'head_shape', options: [
    ['Full', 'full soft lips'],
    ['Thin', 'thin refined lips'],
    ['Cupid Bow', 'lips with a sharply defined cupid bow'],
    ['Glossy', 'high-gloss lips'],
    ['Matte Dark', 'matte dark lip color'],
  ] },
  { id: 'chin_jaw', tab: 'Face', label: 'Chin & Jaw', after: 'head_shape', options: [
    ['Strong Jaw', 'strong, defined jawline'],
    ['Soft Jaw', 'soft rounded jawline'],
    ['Pointed Chin', 'pointed chin'],
    ['Round Chin', 'rounded chin'],
    ['Cleft Chin', 'cleft chin'],
    ['Prominent Chin', 'prominent forward chin'],
  ] },
  { id: 'headwear', tab: 'Style', label: 'Hats & Headphones', after: 'wardrobe_style', options: [
    ['Baseball Cap', 'wearing a plain baseball cap'],
    ['Beanie', 'wearing a knitted beanie'],
    ['Wide-Brim Hat', 'wearing a wide-brim hat'],
    ['Bucket Hat', 'wearing a bucket hat'],
    ['Headphones', 'wearing over-ear headphones'],
  ] },
  { id: 'everyday_accessories', tab: 'Style', label: 'Everyday Accessories', after: 'wardrobe_style', options: [
    ['Glasses', 'wearing everyday glasses at a normal scale'],
    ['Round Glasses', 'wearing round wire-framed glasses'],
    ['Sunglasses', 'wearing regular-sized sunglasses'],
    ['Jewellery', 'wearing small hoop earrings and a thin chain necklace'],
    ['Everyday Bag', 'carrying an ordinary everyday shoulder bag'],
    ['Tote Bag', 'carrying a canvas tote bag'],
  ] },
];

// Extra options for groups that already exist, inserted behind the option
// named in `after` (appended if it is ever missing). Existing options never move
// relative to each other, and the first option of every group is unchanged.
export const CHARACTER_OPTION_ADDITIONS = {
  character_type: [{ after: 'Ant', options: [
    ['Cat', 'anthropomorphic adult cat character with whiskers and feline eyes'],
    ['Dog', 'anthropomorphic adult dog character with a canine muzzle and expressive ears'],
    ['Rodent', 'anthropomorphic adult rodent character with whiskers and a long thin tail'],
    ['Bird', 'anthropomorphic adult bird character with feathers and a beak'],
  ] }],
  skin_tone: [{ after: 'Golden', options: [['Light', 'light skin tone']] }],
  eye_color: [{ after: 'Amber', options: [['Hazel', 'hazel eyes']] }],
  eye_shape: [{ after: 'Upturned', options: [
    ['Almond', 'almond-shaped eyes'],
    ['Monolid', 'monolid eyes with a smooth lid line'],
    ['Hooded', 'hooded eyelids'],
    ['Uneven', 'slightly asymmetric, uneven eyes'],
  ] }],
  mouth: [{ after: 'Unique Teeth', options: [
    ['Gap Teeth', 'a small gap between the front teeth'],
    ['Crooked Teeth', 'charmingly crooked teeth'],
    ['Gold Tooth', 'one gold tooth'],
    ['Bright Smile', 'wide, even, bright smile'],
  ] }],
  facial_hair: [{ after: 'Clean Shaven', options: [
    ['Stubble', 'short stubble shadow along the jaw'],
    ['Full Beard', 'full natural beard'],
    ['Goatee', 'neatly trimmed goatee'],
  ] }],
  hair: [{ after: 'Punk', options: [
    ['Buzz Cut', 'closely buzzed short hair'],
    ['Bowl Cut', 'blunt rounded bowl haircut with a straight fringe, adult styling'],
    ['Mullet', 'mullet haircut, short at the front and long at the back'],
    ['Braids', 'long thick braids'],
    ['Pigtails', 'two high pigtails with polished adult styling'],
    ['Perm', 'tight voluminous permed curls'],
    ['Beehive', 'tall smooth beehive updo'],
    ['Pixie Cut', 'cropped textured pixie cut'],
    ['Ponytail', 'high sleek ponytail'],
    ['Top Knot', 'high top-knot bun'],
    ['Undercut', 'undercut with shaved sides and a longer top'],
    ['Pompadour', 'voluminous swept-up pompadour'],
    ['Cornrows', 'neat cornrow braids'],
    ['Locs', 'long natural locs'],
  ] }],
  hair_color: [
    { after: 'Blonde', options: [['Ginger', 'ginger red hair'], ['Auburn', 'rich auburn hair'], ['Platinum', 'platinum blonde hair']] },
    { after: 'Pink', options: [['Lilac', 'soft lilac hair'], ['Teal', 'deep teal hair']] },
  ],
  wardrobe_style: [{ after: 'Modern Basics', options: [
    ['Streetwear', 'casual streetwear: oversized hoodie, cargo trousers and chunky sneakers'],
    ['Y2K', 'early-2000s Y2K fashion with metallic fabrics and bright futuristic accents'],
    ['Goth', 'goth-inspired layered black clothing with lace, silver hardware and heavy boots'],
    ['Retro', 'retro 1970s-inspired outfit with earth tones, flared trousers and wide collars'],
    ['Sporty', 'sporty athleisure with a zip track jacket, joggers and trainers'],
    ['Business Suit', 'sharply tailored business suit with a crisp shirt'],
  ] }],
};

function insertAfter(options, block) {
  const fresh = block.options.filter(([label]) => !options.some(([existing]) => existing === label));
  const at = options.findIndex(([label]) => label === block.after);
  const index = at === -1 ? options.length : at + 1;
  return [...options.slice(0, index), ...fresh, ...options.slice(index)];
}

const finished = ({ id, tab, label, options }) => ({ id, tab, label, options });

/**
 * The finished builder: the original groups with their extra options inserted,
 * and each new group placed behind the group it refines. Pure; the inputs are
 * never changed. A new group whose anchor is missing goes last.
 */
export function extendCharacterGroups(groups, additions = CHARACTER_OPTION_ADDITIONS, newGroups = CHARACTER_NEW_GROUPS) {
  const ids = new Set(groups.map(({ id }) => id));
  const fresh = newGroups.filter(({ id }) => !ids.has(id));
  const result = groups.flatMap((group) => [
    { ...group, options: (Object.hasOwn(additions, group.id) ? additions[group.id] : []).reduce((all, block) => insertAfter(all, block), group.options) },
    ...fresh.filter(({ after }) => after === group.id).map(finished),
  ]);
  return [...result, ...fresh.filter(({ after }) => !ids.has(after)).map(finished)];
}
