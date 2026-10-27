// Prompt-only image-to-video recipes for popular motion-video trends reviewed on
// 27 October 2026. Each prompt is written for Veyrnox; no source prompt, name,
// reference video or preview media is reused. They run on Kling image-to-video
// from the user's photo and do not copy a reference clip's exact motion.
import { THEME_RECIPES, STEPS, backgroundFor } from './effectConceptTemplates.js';

const RECIPES = [
  {
    id: 'trend-portal-zoom', name: 'PORTAL ZOOM', theme: 'SHOT LANGUAGE', aspect: '9:16',
    prompt: 'Animate the uploaded portrait into a ten-second continuous push-in. The camera glides slowly toward the subject’s face, then into one eye, where the iris opens like a glowing portal onto a vast new landscape. Fly straight through the portal and settle on a wide, sunlit vista. Keep one unbroken camera move with smooth acceleration, sharp focus on the subject before the transition, natural skin texture and no cuts, captions, logos or watermark.',
  },
  {
    id: 'trend-walk-from-the-blaze', name: 'WALK FROM THE BLAZE', theme: 'SUPER POWER', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second action-film shot. The subject walks calmly toward the camera while a large empty building burns far behind them, flames and embers rising into an orange night sky. They never look back. Track backwards at walking pace with a low angle, warm fire rim light on their shoulders and drifting smoke. Keep it cinematic and non-graphic, with no people in danger, no explosions near the subject, and no captions, logos or watermark.',
  },
  {
    id: 'trend-step-into-new-worlds', name: 'STEP INTO NEW WORLDS', theme: 'MORPH ME', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second walking shot in which the world changes with each step. The subject walks forward at a steady pace while the setting shifts seamlessly from a city street to a snowy forest, a desert dune and finally a neon night market. Their face, hair, clothing and stride stay identical throughout. Use one continuous tracking camera, matched lighting at each change and no cuts, captions, logos or watermark.',
  },
  {
    id: 'trend-rooftop-parkour', name: 'ROOFTOP PARKOUR', theme: 'SOCCER FEVER', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second rooftop parkour run at golden hour. The subject sprints across flat rooftops, vaults a low railing, makes a short controlled gap jump and lands in a confident roll before rising to face the camera. Follow with a smooth handheld tracking camera, realistic body mechanics, clear foot contact and a safe, believable landing. Keep their identity and outfit consistent, with no captions, logos or watermark.',
  },
  {
    id: 'trend-cat-stage-star', name: 'CAT STAGE STAR', theme: 'PET', aspect: '9:16',
    prompt: 'Animate the uploaded pet photo into a ten-second stage performance. The animal stands on a small theatre stage under a warm spotlight, sways to the music, does a playful paw wave and finishes with a proud bow as gentle confetti falls. Keep the pet recognisable, with natural fur, believable proportions and expressive but natural movement. Use a slow push-in from the stalls, with no human hands, captions, logos or watermark.',
  },
  {
    id: 'trend-bag-slide-reveal', name: 'BAG SLIDE REVEAL', theme: 'E-COMMERCE', aspect: '9:16',
    prompt: 'Animate the uploaded product photo into a ten-second luxury reveal. The product slides smoothly across a long polished marble counter, slows to a precise stop in the centre of frame and turns slightly to show its best angle while a soft light sweep crosses its surface. Preserve its exact shape, colours, materials and branding. Use a low tracking camera, shallow depth of field, clean reflections and no captions, added logos or watermark.',
  },
  {
    id: 'trend-golden-gown', name: 'GOLDEN GOWN', theme: 'STYLE', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second fashion transformation. Threads of light wrap around the subject from the feet upward and their outfit turns into a flowing floor-length gown of woven gold that catches the light as they turn slowly. Preserve their face, hair, skin tone and body proportions exactly. Use a slow orbiting camera, warm studio light, natural fabric movement and no captions, logos or watermark.',
  },
  {
    id: 'trend-street-runway', name: 'STREET RUNWAY', theme: 'STYLE', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second street catwalk. The subject walks down the centre of a pastel-painted city street with a confident runway stride, a quick look to the side and a pause and pose at the end. Passers-by stop to watch, softly out of focus. Use a steady backward tracking camera at hip height, bright daylight, natural fabric motion and consistent identity and outfit, with no captions, logos or watermark.',
  },
  {
    id: 'trend-duo-dance-routine', name: 'DUO DANCE ROUTINE', theme: 'AI DANCE', aspect: '9:16',
    prompt: 'Animate the uploaded photo of two people into a ten-second synchronised dance. Standing side by side in a bright studio, they perform the same original routine in time: a step-touch, a shoulder bounce, a spin and a matching final pose. Keep each person in their own position with their own face, hair and clothing. Use a fixed camera, grounded footwork, natural balance and no extra dancers, captions, logos or watermark.',
  },
  {
    id: 'trend-neon-solo-routine', name: 'NEON SOLO ROUTINE', theme: 'AI DANCE', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second solo dance under magenta and blue neon light. The subject performs an original, energetic routine with sharp arm hits, a body wave and a confident final freeze facing the camera. Keep their feet planted with each step, joints natural and clothing consistent. Use a gentle handheld push-in, light haze and reflections on a glossy floor, with no captions, logos or watermark.',
  },
  {
    id: 'trend-tray-balance-waiter', name: 'TRAY BALANCE WAITER', theme: 'QUIRK LAB', aspect: '9:16',
    prompt: 'Animate the uploaded photo into a ten-second comedy moment. The subject, dressed as a waiter, weaves through a busy restaurant carrying a tall stack of plates on one tray. The stack wobbles wildly, they lean and twist to save it, and it settles perfectly as they give the camera a relieved wink. Keep their identity recognisable, with believable physics, a smooth following camera and no broken plates, captions, logos or watermark.',
  },
  {
    id: 'trend-retro-diner', name: 'RETRO DINER', theme: 'SHOT LANGUAGE', aspect: '16:9',
    prompt: 'Animate the uploaded portrait into a ten-second 1950s diner scene. The subject sits in a red leather booth beside a window, stirs a milkshake, glances out at the rain and then smiles at the camera as a jukebox glows behind them. Keep their face and hair recognisable, with period clothing in matching colours. Use a slow dolly-in, warm practical lights, soft film grain and no captions, logos or watermark.',
  },
  {
    id: 'trend-star-of-the-ad', name: 'STAR OF THE AD', theme: 'E-COMMERCE', aspect: '9:16',
    prompt: 'Animate the uploaded photo of a person holding a product into a ten-second television commercial. They present the product to camera with a natural smile, turn it to show the front, and take one confident step forward as the background shifts to a clean, bright studio. Preserve the person’s identity and the product’s exact shape, colours and branding. Use polished commercial lighting, a smooth push-in and no added captions, logos or watermark.',
  },
  {
    id: 'trend-dragon-flight-ride', name: 'DRAGON FLIGHT RIDE', theme: 'SUPER POWER', aspect: '16:9',
    prompt: 'Animate the uploaded photo into a ten-second fantasy flight. The subject rides on the back of an original emerald dragon soaring above misty mountains at sunrise, holding on as the wings beat slowly and the dragon banks into a wide turn. Keep their face, hair and outfit recognisable, with hair moving in the wind. Use a sweeping aerial tracking camera, golden light and no copied characters, captions, logos or watermark.',
  },
  {
    id: 'trend-open-road-cruise', name: 'OPEN ROAD CRUISE', theme: 'SHOT LANGUAGE', aspect: '16:9',
    prompt: 'Animate the uploaded portrait into a ten-second road-trip shot. The subject drives an unbranded classic convertible along a coastal highway at sunset, one hand on the wheel, hair moving in the wind, glancing at the camera with a relaxed smile. Keep their identity consistent. Use a smooth side-tracking camera from a moving vehicle, warm low sun, gentle lens flare and no visible badges, captions, logos or watermark.',
  },
  {
    id: 'trend-toy-sized-me', name: 'TOY-SIZED ME', theme: 'MORPH ME', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second shrinking moment. The subject stands in a bright playroom and shrinks smoothly to the size of a toy, then looks up in wonder at giant building blocks and a towering teddy bear before climbing onto a block and waving. Keep their face, clothing and proportions consistent at the new scale. Use a camera that lowers to floor level, soft daylight and no captions, logos or watermark.',
  },
  {
    id: 'trend-desert-road-duo', name: 'DESERT ROAD DUO', theme: 'AI GIFT', aspect: '16:9',
    prompt: 'Animate the uploaded photo of two people into a ten-second road-movie shot. The pair walk side by side down the middle of an empty desert highway at golden hour, laughing and nudging each other before stopping to look out at the horizon. Keep each person’s face, hair, clothing and position consistent. Use a slow backward tracking camera, heat shimmer in the distance, warm light and no extra people, captions, logos or watermark.',
  },
  {
    id: 'trend-slow-dance-couple', name: 'SLOW DANCE COUPLE', theme: 'AI GIFT', aspect: '9:16',
    prompt: 'Animate the uploaded photo of a couple into a ten-second slow dance. In a softly lit room strung with warm lights, they sway together, share a gentle spin and end resting their foreheads together with a smile. Keep both identities, outfits and their relative heights consistent. Use a slow orbiting camera, shallow depth of field, warm bokeh and natural, respectful movement, with no captions, logos or watermark.',
  },
  {
    id: 'trend-city-freestyle', name: 'CITY FREESTYLE', theme: 'AI DANCE', aspect: '9:16',
    prompt: 'Animate the uploaded full-body photo into a ten-second street dance on a city corner. The subject freestyles with relaxed grooves, quick footwork and a smooth spin, then finishes with a crossed-arm pose toward the camera as city lights blur behind them. Keep their identity and outfit consistent, with grounded feet and natural joints. Use a low handheld camera that circles slightly, evening light and no extra dancers, captions, logos or watermark.',
  },
  {
    id: 'trend-match-cut-montage', name: 'MATCH-CUT MONTAGE', theme: 'SHOT LANGUAGE', aspect: '9:16',
    prompt: 'Animate the uploaded portrait into a ten-second travel montage built on match cuts. The subject repeats the same head turn toward the camera in four locations, a beach, a city rooftop, a forest trail and a night street, each change happening exactly on the turn. Keep their face, hair and framing identical across every location. Use crisp, rhythmic transitions, matched eye lines and lighting, and no captions, logos or watermark.',
  },
];

export const MOTION_TREND_TEMPLATES = RECIPES.map(({ id, name, theme, aspect, prompt }) => {
  const recipe = THEME_RECIPES[theme];
  return {
    id, name, theme, aspect,
    model: 'Kling 3.0 · I2V',
    credits: 32,
    durationSeconds: 10,
    category: recipe.category,
    previewAspect: aspect === '16:9' ? '16 / 9' : '9 / 16',
    isNew: true,
    inspired: true,
    promptOrigin: 'veyrnox-adaptation',
    bg: backgroundFor(id, theme),
    needs: recipe.needs,
    needsKey: recipe.needsKey,
    prompt,
    negativePrompt: recipe.negativePrompt,
    steps: STEPS,
  };
});
