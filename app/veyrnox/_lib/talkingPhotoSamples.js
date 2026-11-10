export const TALKING_PHOTO_SAMPLES = Object.freeze([
  {
    id: 'mara',
    name: 'Mara',
    role: 'Studio presenter',
    src: '/avatars/fictional/mara.png',
    filename: 'veyrnox-mara-fictional.png',
    alt: 'Fictional adult studio presenter Mara on a muted teal background',
  },
  {
    id: 'ellis',
    name: 'Ellis',
    role: 'Creative host',
    src: '/avatars/fictional/ellis.png',
    filename: 'veyrnox-ellis-fictional.png',
    alt: 'Fictional adult creative host Ellis on a warm clay background',
  },
  {
    id: 'nia',
    name: 'Nia',
    role: 'Learning guide',
    src: '/avatars/fictional/nia.png',
    filename: 'veyrnox-nia-fictional.png',
    alt: 'Fictional adult learning guide Nia on a muted violet background',
  },
  {
    id: 'kenji',
    name: 'Kenji',
    role: 'Product specialist',
    src: '/avatars/fictional/kenji.png',
    filename: 'veyrnox-kenji-fictional.png',
    alt: 'Fictional adult product specialist Kenji on a muted blue-green background',
  },
]);

export function talkingPhotoSampleById(id) {
  return TALKING_PHOTO_SAMPLES.find((sample) => sample.id === id) || null;
}
