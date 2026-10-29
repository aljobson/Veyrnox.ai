// These community examples inspire image-to-video recipes, but the preview is not a motion reference.
const base = {
  model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  isNew: true, inspired: true, promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, extra limbs, flicker, captions, logos, watermark',
};

const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its editable ten-second prompt and settings.',
  'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
];

const guidance = {
  CARTOONS: { needsKey: 'community.cartoons', sourceGuidance: 'A clear full-body animal or original character image' },
  CINEMATIC: { needsKey: 'community.cinematic', sourceGuidance: 'A clear full-body portrait with room for cinematic movement' },
  FASHION: { needsKey: 'community.fashion', sourceGuidance: 'A clear full-body fashion portrait with clothing unobstructed' },
  MOVIES: { needsKey: 'community.movies', sourceGuidance: 'A clear portrait of the original character or cast' },
  PRODUCTS: { needsKey: 'community.products', sourceGuidance: 'A clear image of the subject and featured vehicle or product' },
  UGC: { needsKey: 'community.ugc', sourceGuidance: 'A clear portrait with face, hands and clothing visible' },
  VFX: { needsKey: 'community.vfx', sourceGuidance: 'A clear subject image with open space around the effect area' },
};

const groupGuidance = { needsKey: 'community.group', sourceGuidance: 'One starting image containing every subject in their intended positions' };
const groupIds = new Set(['ancient-attire-dance', 'costume-dance-duo', 'outdoor-duo-dance', 'studio-rap-duo', 'twilight-field-memory']);

const recipes = [
  {
    id: 'cash-fan-performance', name: 'CASH FAN PERFORMANCE', category: 'UGC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#171b20,#4d634c,#d6c77c)',
    action: 'Have the subject lift and fan a thick stack of neutral prop banknotes in a confident rhythmic performance. Keep the hands readable, the notes separated and the face stable as the camera makes a small push-in.',
  },
  {
    id: 'miniature-car-window-journey', name: 'MINIATURE CAR WINDOW JOURNEY', category: 'PRODUCTS', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#172431,#52687d,#d7c7a7)',
    action: 'Turn the photographed car into a detailed miniature travelling along a train-window ledge, then reveal that the tiny road continues into a sweeping outdoor landscape. Keep the vehicle design consistent across the scale transition.',
  },
  {
    id: 'square-character-recast', name: 'SQUARE CHARACTER RECAST', category: 'VFX', aspect: '1:1', previewAspect: '600 / 600',
    bg: 'linear-gradient(155deg,#21192f,#6e4975,#d8a7a9)',
    action: 'Stage a compact character-performance shot in which the uploaded subject takes centre frame, moves through a short expressive pose sequence and finishes on a strong hero close-up. Preserve their face, costume and proportions throughout.',
  },
  {
    id: 'football-showstopper', name: 'FOOTBALL SHOWSTOPPER', category: 'CINEMATIC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#091b21,#195c4d,#d7cf76)',
    action: 'Follow the player through a cinematic dribble, a clean chip over an approaching goalkeeper and a composed finish. Preserve the player’s identity and kit while keeping the ball path, foot contacts and supporting players physically coherent.',
  },
  {
    id: 'ancient-attire-dance', name: 'ANCIENT ATTIRE DANCE', category: 'FASHION', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#3b241b,#9a6741,#e7c993)',
    action: 'Dress the people in original historically inspired ceremonial garments and animate a joyful outdoor dance. Retain their poses, expressions and gaze direction while fabric layers, jewellery and hair move naturally in the same warm light.',
  },
  {
    id: 'costume-dance-duo', name: 'COSTUME DANCE DUO', category: 'FASHION', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#22163e,#70499b,#f0b7cd)',
    action: 'Turn the two subjects into an original coordinated costume duo performing energetic, synchronised choreography. Keep each person visually distinct, preserve their facial identity and avoid swapping faces, bodies or wardrobe details between them.',
  },
  {
    id: 'cinematic-car-cast', name: 'CINEMATIC CAR CAST', category: 'PRODUCTS', aspect: '16:9', previewAspect: '600 / 338',
    bg: 'linear-gradient(155deg,#101b28,#4d6479,#d7b890)',
    action: 'Build a polished road-film moment around the photographed person and car. Start with a low tracking view of the vehicle, reveal the driver beside it and finish with both moving through a broad cinematic landscape without changing their design.',
  },
  {
    id: 'identity-locked-performance', name: 'IDENTITY-LOCKED PERFORMANCE', category: 'UGC', aspect: '1:1', previewAspect: '600 / 608',
    bg: 'linear-gradient(155deg,#1d2430,#66707c,#d6c6bb)',
    action: 'Animate a natural close performance with small head turns, speech-like mouth motion and expressive eye movement. Keep facial proportions, skin texture, hair and jawline consistent through every turn, with realistic occlusion and motion blur.',
  },
  {
    id: 'night-party-dancer', name: 'NIGHT PARTY DANCER', category: 'UGC', aspect: '9:16', previewAspect: '600 / 1196',
    bg: 'linear-gradient(155deg,#160f24,#5c315e,#d26c7c)',
    action: 'Place the subject at the centre of a lively night-party floor and animate a short, confident dance phrase. Preserve the original outfit and identity while coloured practical lights, background guests and handheld camera energy stay coherent.',
  },
  {
    id: 'red-room-performance', name: 'RED ROOM PERFORMANCE', category: 'CINEMATIC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#24090e,#7d1824,#dc665a)',
    action: 'Stage an intimate performance in a red-lit venue, with the subject delivering precise hand gestures while a small crowd moves behind them. Keep the face and wardrobe stable under saturated light and preserve natural depth and motion blur.',
  },
  {
    id: 'miniature-car-road-trip', name: 'MINIATURE CAR ROAD TRIP', category: 'PRODUCTS', aspect: '16:9', previewAspect: '600 / 338',
    bg: 'linear-gradient(155deg,#122231,#4c7f91,#e6bd76)',
    action: 'Transform the uploaded car into a premium miniature that races through changing scenic roads and illuminated highway tunnels. Keep the same body shape, paint, wheels and reflections as the camera alternates between close tracking and wide landscape views.',
  },
  {
    id: 'desert-truck-jump', name: 'DESERT TRUCK JUMP', category: 'CINEMATIC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#442513,#bd6d30,#f4c675)',
    action: 'At golden hour, keep the seated subject calm in the foreground while a large original off-road truck launches from a distant dune, passes safely overhead and lands well behind them in a rolling cloud of dust. Use believable suspension, shadows and scale.',
  },
  {
    id: 'skyway-chase', name: 'SKYWAY CHASE', category: 'CARTOONS', aspect: '16:9', previewAspect: '600 / 338',
    bg: 'linear-gradient(155deg,#171f39,#425fa0,#ef8a63)',
    action: 'Send the original character through a fast elevated-city chase beside a futuristic rider. Match running, jumps and expressive poses to dynamic tracking shots while keeping the city, vehicles and character design consistent and clearly separated.',
  },
  {
    id: 'outdoor-duo-dance', name: 'OUTDOOR DUO DANCE', category: 'UGC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#17312a,#65906c,#e4ca91)',
    action: 'Animate the two subjects performing an upbeat outdoor routine with alternating gestures and a shared final pose. Keep their identities, clothing and body proportions distinct while the camera follows with gentle handheld energy.',
  },
  {
    id: 'studio-rap-duo', name: 'STUDIO RAP DUO', category: 'UGC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#3a1c0d,#d45a18,#f4a650)',
    action: 'Place both performers in a bold orange studio beneath a hanging microphone. Animate rhythmic gestures and alternating delivery while keeping each face, outfit and position consistent under crisp music-video lighting.',
  },
  {
    id: 'fireball-walkaway', name: 'FIREBALL WALKAWAY', category: 'VFX', aspect: '9:16', previewAspect: '480 / 854',
    bg: 'linear-gradient(155deg,#17191d,#874423,#f29a49)',
    action: 'Have the subject walk calmly toward camera as a controlled cinematic fireball blooms far behind them. Keep the blast safely separated, preserve the person’s face and stride, and integrate heat haze, backlight, debris and camera shake without distorting the scene.',
  },
  {
    id: 'football-character-recast', name: 'FOOTBALL CHARACTER RECAST', category: 'CINEMATIC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#0f251d,#397157,#d7c46d)',
    action: 'Place the uploaded character into a playful football sequence, matching a run, close footwork and ball contacts before a celebratory finish. Preserve their face, outfit and distinctive footwear while the other players, stadium and ball remain coherent.',
  },
  {
    id: 'k9-dance-groove', name: 'K9 DANCE GROOVE', category: 'CARTOONS', aspect: '9:16', previewAspect: '480 / 854',
    bg: 'linear-gradient(155deg,#302216,#8d6842,#d8c49a)',
    action: 'Animate the dog as a playful upright dancer in a modern kitchen, following a short rhythmic groove while retaining its exact coat pattern, eye colour and proportions. Keep paws, face and body stable with natural contact shadows and no glowing eyes.',
  },
  {
    id: 'twilight-field-memory', name: 'TWILIGHT FIELD MEMORY', category: 'MOVIES', aspect: '9:16', previewAspect: '600 / 886',
    bg: 'linear-gradient(155deg,#182225,#536b55,#e4b66f)',
    action: 'Create an original emotional sequence that moves from a tense, rain-dark interior into a warm field memory at sunset. Keep both identities and wardrobe consistent as the mood shifts through a match cut, gentle wind, wet highlights and fine film grain.',
  },
  {
    id: 'cash-stack-flex', name: 'CASH STACK FLEX', category: 'UGC', aspect: '9:16', previewAspect: '600 / 1066',
    bg: 'linear-gradient(155deg,#1c211b,#4e6b45,#c8bc72)',
    action: 'Animate a close handheld performance in which the subject counts and stacks neutral prop banknotes on beat, then presents the finished stack to camera. Preserve hand anatomy, facial identity, camera angle and the readable separation of every note.',
  },
];

export const SOURCE_TEMPLATE_EXPANSION_8 = recipes.map(({ action, aspect, ...recipe }) => {
  const adaptedPrompt = `Animate the uploaded image into a polished ten-second ${recipe.name.toLowerCase()} sequence. The example is inspiration; generate an original shot from the uploaded image rather than copying its exact motion. ${action} Use stable anatomy, natural lighting, smooth motion and no added captions, logos or watermark.`;
  return {
    ...base, ...recipe,
    needsKey: (groupIds.has(recipe.id) ? groupGuidance : guidance[recipe.category]).needsKey,
    needs: (groupIds.has(recipe.id) ? groupGuidance : guidance[recipe.category]).sourceGuidance,
    sourceAspect: aspect, clipKey: recipe.id, steps,
    promptOrigin: 'veyrnox-adaptation',
    prompt: adaptedPrompt,
  };
});

export const SHOWCASE_CLIP_EXPANSION_8 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_8.map((entry) => [entry.clipKey, {
  video: `/showcase/creator-${entry.id}.mp4`, poster: `/showcase/creator-${entry.id}.webp`, aspectRatio: entry.previewAspect,
  title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
