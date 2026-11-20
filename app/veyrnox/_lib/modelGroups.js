// The model-list groups and their labels and hues. Kept apart from _sections/showcase.js so a page that only
// needs these (/models) does not pull the template catalog in through showcase.js (ADR-0353 follow-up, cold start).

export const LIST_GROUPS = [
  { kind: 'video', label: 'Video', unit: 'per clip; length shown below.' },
  { kind: 'image', label: 'Image', unit: 'per image.' },
  { kind: 'audio', label: 'Audio', unit: 'per clip.' },
];

// The catalog keys for a group's label and unit (the English above is what
// /models prints; the landing page reads these).
export const GROUP_KEYS = {
  video: { label: 'home.models.video', unit: 'home.models.unitVideo' },
  image: { label: 'home.models.image', unit: 'home.models.unitImage' },
  audio: { label: 'home.models.audio', unit: 'home.models.unitAudio' },
};

// A kind wears the hue it has in the mobile app (PresetCard.tsx): video iris,
// image sky, audio rose. On the heading only: prices stay amber.
export const KIND_HUE = { video: 'text-vx-hue-iris', image: 'text-vx-hue-sky', audio: 'text-vx-hue-rose' };
