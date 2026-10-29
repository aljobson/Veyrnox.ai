const base = {
  model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  isNew: true, inspired: true, promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, extra limbs, flicker, jump cuts, captions, logos, watermark',
};

const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its editable ten-second prompt and settings.',
  'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
];

const categoryMeta = {
  CINEMATIC: { needsKey: 'community.cinematic', sourceGuidance: 'A clear full-body portrait with room for cinematic movement' },
  FASHION: { needsKey: 'community.fashion', sourceGuidance: 'A clear full-body fashion portrait with clothing unobstructed' },
  MOVIES: { needsKey: 'community.movies', sourceGuidance: 'A clear portrait of the original character or cast' },
  PRODUCTS: { needsKey: 'community.products', sourceGuidance: 'A clear image of the subject and featured vehicle or product' },
  UGC: { needsKey: 'community.ugc', sourceGuidance: 'A clear portrait with face, hands and clothing visible' },
  VFX: { needsKey: 'community.vfx', sourceGuidance: 'A clear subject image with open space around the effect area' },
};

const recipes = [
  ['beyond-gravity', 'BEYOND GRAVITY', 'VFX', '406 / 720', null, 'the full-body subject performs one continuous athletic stunt: a fast approach, grounded leaps, aerial rotations, a controlled landing and a short slide while the camera tracks the complete trajectory'],
  ['chasing-you', 'CHASING YOU', 'PRODUCTS', '270 / 480', null, 'the uploaded vehicle executes a continuous automotive POV sequence with aggressive sideways drifting, close passes and precisely timed camera-relative movement'],
  ['cinematic-showcase-2', 'CINEMATIC SHOWCASE 2', 'PRODUCTS', '406 / 720', null, 'the uploaded hero subject replaces the original object across a fast multi-shot showcase, preserving consistent scale and design through changing hero angles, detail frames and camera transitions'],
  ['cinematic-showcase', 'CINEMATIC SHOWCASE', 'PRODUCTS', '406 / 720', null, 'the uploaded hero subject is presented through a fourteen-shot product-style sequence of wide, detail, side and rear three-quarter frames with crisp hard cuts and consistent geometry'],
  ['basketball-3', 'BASKETBALL 3', 'CINEMATIC', '406 / 720', 'community.group', 'two distinct players recreate a one-on-one basketball exchange: the lead handles the ball and beats the defender while both preserve their separate reactions, spatial relationship and identities'],
  ['reality-shift', 'REALITY SHIFT', 'PRODUCTS', '1280 / 720', null, 'a miniature version of the uploaded vehicle rests on a daylight windowsill, then the same continuous view transforms into a night tunnel as the miniature becomes the identical full-size car driving through cinematic detail and tracking shots'],
  ['live-stage-performance', 'LIVE STAGE PERFORMANCE', 'UGC', '406 / 720', null, 'one performer recreates an energetic continuous dance on a glossy blue live-show stage, including grounded footwork, floor choreography, recovery and a strong finish before a cheering audience'],
  ['football', 'FOOTBALL', 'CINEMATIC', '270 / 480', 'community.group', 'the lead player keeps possession through a coordinated group of defenders in an empty red-seat stadium, with faithful close control, challenges, reactions and commercial-style football choreography'],
  ['brixton', 'BRIXTON', 'UGC', '406 / 720', null, 'the uploaded lead recreates a complete early-2000s-inspired live-action music-video performance, preserving the source choreography, gestures, expressions, lip-sync, shot order and restrained location continuity'],
  ['unforgettable', 'UNFORGETTABLE', 'PRODUCTS', '640 / 360', 'community.group', 'the performer approaches camera, presents two matching physical cards, lowers them and reacts as the uploaded vehicle is revealed at the original cue, remaining parked and visually consistent through the final views'],
  ['natural-viral-makeover', 'NATURAL VIRAL MAKEOVER', 'FASHION', '1280 / 720', 'community.group', 'two friends share a natural smartphone bathroom makeover: matching lipstick application, believable banter and reactions, then a rhythmic jump-cut reveal of their separate polished outfits without identity swapping'],
  ['freestyle', 'FREESTYLE', 'UGC', '1280 / 720', 'community.group', 'a seated rapper performs beside a seated streamer while four supporting characters retain their assigned roles across a coherent early-2000s-inspired performance, matching the source coverage, gestures, edits and lip-sync'],
  ['the-lost-chase', 'THE LOST CHASE', 'MOVIES', '406 / 720', 'community.group', 'the lead recreates the full dance performance while a second, visually distinct character appears only for the single frightened reaction, with role timing, outfits and identities kept separate'],
  ['burning-bridges', 'BURNING BRIDGES', 'UGC', '1280 / 720', 'community.group', 'the singer and replacement dance crowd recreate the source music-video performance inside one coherent environment derived from the location reference, preserving choreography, camera coverage, edits and lip-sync'],
  ['retro-hip-hop-spotlight', 'RETRO HIP-HOP SPOTLIGHT', 'UGC', '854 / 480', null, 'the replacement performer follows the source hip-hop performance shot for shot, appearing only where the original lead appears while preserving choreography, lip-sync, cuts, spotlight staging and the stable original environment'],
  ['wheelie-rider', 'WHEELIE RIDER', 'CINEMATIC', '270 / 480', null, 'the full-body rider remains physically connected to the motorcycle, accelerates into the same controlled wheelie trajectory and returns to two wheels with believable balance, limb placement and camera timing'],
  ['mystery-unboxing', 'MYSTERY UNBOXING', 'PRODUCTS', '406 / 720', 'community.group', 'a box falls from a vehicle, follows a believable collision arc and lands near the character, who opens it with grounded physical contact and reveals the uploaded object already resting naturally inside'],
  ['whiskey-gun-trick', 'WHISKEY GUN TRICK', 'UGC', '270 / 480', null, 'the character recreates the original kitchen-counter performance, approaching the glasses and manipulating one consistent glass decanter through a precise multi-glass pouring sequence before a final interaction'],
  ['cyber-mask-transformation', 'CYBER MASK TRANSFORMATION', 'VFX', '270 / 480', 'community.group', 'the unmasked character performs energetic fisheye parking-garage choreography, physically raises and puts on the uploaded mask midway, then completes the masked glitch-and-hallway sequence with the mask attached and unchanged'],
  ['pizzeria-hide-and-seek', 'PIZZERIA HIDE AND SEEK', 'MOVIES', '360 / 480', null, 'the protagonist begins with a frightened selfie in an abandoned pizzeria, turns to first-person view, hides as a heavy mechanical mascot approaches around real obstacles, discovers it close to the lens and flees before the recording cuts off'],
];

export const SOURCE_TEMPLATE_EXPANSION_10 = recipes.map(([id, name, category, previewAspect, needsKey, concept]) => ({
  ...base, id, name, category, previewAspect, needsKey: needsKey || categoryMeta[category].needsKey,
  needs: needsKey === 'community.group' ? 'One starting image containing every subject in their intended positions' : categoryMeta[category].sourceGuidance, clipKey: id, steps,
  bg: 'linear-gradient(155deg,#111923 0%,#455669 55%,#c99672 100%)',
  prompt: `Animate the uploaded starting image into a polished ten-second ${name.toLowerCase().replace(/\s+\d+$/, '')} sequence. The example is inspiration; create an original shot in which ${concept}. Preserve every uploaded reference's recognizable identity, design, proportions, materials, colours, clothing and role throughout. Keep anatomy and object geometry stable, physical contact coherent and motion naturally weighted. Use controlled camera movement, consistent lighting and no captions, logos or watermark.`,
}));

export const SHOWCASE_CLIP_EXPANSION_10 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_10.map((entry) => [entry.clipKey, {
  video: `/showcase/viral-${entry.id}.mp4`,
  poster: `/showcase/viral-${entry.id}.jpg`,
  aspectRatio: entry.previewAspect,
  title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
