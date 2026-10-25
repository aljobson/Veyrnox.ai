const base = {
  model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  isNew: true, inspired: true, promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, flicker, jump cuts, captions, logos, watermark',
};

const steps = [
  'Upload a clear photo you have permission to use.',
  'Adjust the scene and visual details in the prompt.',
  'Generate a 5s or 10s shot, or build a longer multi-shot film in Film Studio.',
];

const recipes = [
  { id: 'raven-transition', name: 'RAVEN TRANSITION', category: 'VFX', aspect: '9:16', previewAspect: '600 / 800', needs: 'A clear portrait with space around the subject', bg: 'linear-gradient(155deg,#111522,#3b4357,#9aa7bb)', action: 'A flock of ravens sweeps across the frame, momentarily concealing the subject and revealing a dramatic new scene as the birds clear. Use a seamless continuous camera move and realistic feathers.' },
  { id: 'firework-reveal', name: 'FIREWORK REVEAL', category: 'VFX', aspect: '16:9', previewAspect: '600 / 450', needs: 'A clear portrait outdoors or against an open background', bg: 'linear-gradient(155deg,#151329,#753253,#ffc479)', action: 'Reveal a night sky filled with colourful fireworks behind the subject. Let the light from each burst illuminate the scene and the subject naturally while the camera gently pulls back.' },
  { id: 'northern-lights-journey', name: 'NORTHERN LIGHTS JOURNEY', category: 'CINEMATIC', aspect: '9:16', previewAspect: '600 / 800', needs: 'A full-body portrait with an open background', bg: 'linear-gradient(155deg,#071b2d,#135868,#83e3b2)', action: 'Place the subject in a snowy mountain landscape beneath moving green and violet aurora. Drift the camera smoothly through the winter scene as soft snow blows past, keeping the subject recognisable.' },
  { id: 'fairy-lights', name: 'FAIRY LIGHTS', category: 'FANTASY', aspect: '9:16', previewAspect: '600 / 800', needs: 'A clear seated or standing portrait', bg: 'linear-gradient(155deg,#22143c,#70449e,#edb9ff)', action: 'Small glowing fairies circle the subject, leaving delicate violet and gold trails. Their warm light reflects naturally on the surroundings as the camera eases closer to a magical final moment.' },
  { id: 'outfit-switch', name: 'OUTFIT SWITCH', category: 'FASHION', aspect: '16:9', previewAspect: '600 / 446', needs: 'A clear full-body fashion portrait', bg: 'linear-gradient(155deg,#1b202a,#777f8c,#ede4d5)', action: 'Create a smooth fashion transformation in which the subject changes into a new coordinated outfit with one flowing movement. Preserve the subject’s identity and body proportions, with consistent lighting and natural fabric motion.' },
];

export const SOURCE_TEMPLATE_EXPANSION_6 = recipes.map(({ action, ...recipe }) => ({
  ...base, ...recipe, clipKey: recipe.id, steps,
  prompt: `Animate the uploaded image into a polished ten-second ${recipe.name.toLowerCase()} sequence. Preserve the subject’s identity and proportions. ${action} Use stable anatomy, natural light and smooth motion. Add no text, logos or watermark.`,
}));

export const SHOWCASE_CLIP_EXPANSION_6 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_6.map((entry) => [entry.clipKey, {
  video: `/showcase/viral-${entry.id}.mp4`, aspectRatio: entry.previewAspect,
  poster: `/showcase/viral-${entry.id}.jpg`,
  title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
