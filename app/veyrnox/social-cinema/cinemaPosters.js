const POSTERS = Object.freeze({
  '5cc7db34-2b81-4eb2-83bf-7e52ff650b07': '/cinema/posters/painting-with-the-breeze.jpg',
  'b41362d4-b6a0-46ad-b0ab-d4e00ceb8d68': '/cinema/posters/late-afternoon-swans.jpg',
  '6138d6ab-35ba-48f5-934f-f8da387d2d45': '/cinema/posters/grey-haired-cafe-veo3.jpg',
  'c928cfef-ed3a-4560-afbf-ff72927eaa32': '/cinema/posters/visual-kei-lemonade-veo3.jpg',
});

export function cinemaPosterFor(id) {
  return POSTERS[String(id || '').toLowerCase()] || null;
}

export const cinemaPosterIds = Object.freeze(Object.keys(POSTERS));
