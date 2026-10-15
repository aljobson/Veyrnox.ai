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

export function changeCharacterPick(picks, key, value) {
  const next = { ...picks };
  if (value) next[key] = value; else delete next[key];
  if (key === 'hand_size' && value && ['Huge Hands', 'Tiny Hands'].includes(next.proportions)) delete next.proportions;
  if (key === 'proportions' && ['Huge Hands', 'Tiny Hands'].includes(value)) delete next.hand_size;
  if (key === 'ear_size' && value && next.ears === 'No Ears') delete next.ears;
  if (key === 'ears' && value === 'No Ears') delete next.ear_size;
  if (key === 'mouth_size' && value && ['Small Mouth', 'Large Mouth'].includes(next.mouth)) delete next.mouth;
  if (key === 'mouth' && ['Small Mouth', 'Large Mouth'].includes(value)) delete next.mouth_size;
  if (key === 'head_size' && value && ['Tiny Head', 'Oversized Head'].includes(next.head_shape)) delete next.head_shape;
  if (key === 'head_shape' && ['Tiny Head', 'Oversized Head'].includes(value)) delete next.head_size;
  return next;
}

export const CHARACTER_SIZE_GROUPS = [
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
