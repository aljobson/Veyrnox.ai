// These examples inspire image-to-video recipes; the preview is not a motion reference.
const base = {
  model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  isNew: true, inspired: true, promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, flicker, captions, logos, watermark',
};
const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its editable ten-second prompt and settings.',
  'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
];
const recipes = [
  { id:'street-meeting-motorbike', name:'STREET MEETING', category:'CINEMATIC', aspect:'16:9', previewAspect:'16 / 9', bg:'linear-gradient(155deg,#1a292b,#75726b,#d9cbbc)', action:'Stage a spontaneous meeting between two people beside a parked motorbike. Move from a wide street view to a closer fashion portrait with a smooth camera move and natural gestures.' },
  { id:'pop-portrait-outside', name:'POP PORTRAIT', category:'UGC', aspect:'16:9', previewAspect:'16 / 9', bg:'linear-gradient(155deg,#53242e,#cb737b,#f2c4c8)', action:'Create a playful handheld portrait that moves from a bright interior to an outdoor street. Keep the performer centred, with confident gestures and a punchy music-video rhythm.' },
  { id:'colourful-city-split', name:'COLOURFUL CITY SPLIT', category:'FASHION', aspect:'9:16', previewAspect:'9 / 16', bg:'linear-gradient(155deg,#6d3159,#e77f8d,#f5c785)', action:'Blend a vivid fashion portrait against a painted wall with an energetic urban walkway using a smooth vertical wipe. Give the subject a lively fashion pose and keep their identity stable through the transition.' },
  { id:'umbrella-world-switch', name:'UMBRELLA WORLD SWITCH', category:'CINEMATIC', aspect:'9:16', previewAspect:'9 / 16', bg:'linear-gradient(155deg,#16291e,#4e7452,#c5d8af)', action:'Follow the subject carrying an umbrella from a paved city setting into a lush green garden. Let the umbrella motivate a seamless scene change while keeping the subject consistent.' },
  { id:'selfie-city-journey', name:'SELFIE CITY JOURNEY', category:'UGC', aspect:'16:9', previewAspect:'16 / 9', bg:'linear-gradient(155deg,#292b37,#8c6453,#e3cbb5)', action:'Follow a handheld selfie journey through a transit station into an elegant gallery. Use a continuous forward-moving camera, natural walking motion and a smooth architectural transition.' },
  { id:'animated-city-stride', name:'ANIMATED CITY STRIDE', category:'CARTOONS', aspect:'9:16', previewAspect:'9 / 16', bg:'linear-gradient(155deg,#14213c,#d67941,#f0c67c)', action:'Transform the subject into an original bold animated character striding across a busy city crossing. Blend the illustrated figure with a realistic environment and finish with a confident pose.' },
  { id:'travel-fashion-transition', name:'TRAVEL FASHION TRANSITION', category:'FASHION', aspect:'16:9', previewAspect:'16 / 9', bg:'linear-gradient(155deg,#242b36,#aa6572,#f1dfce)', action:'Turn a travel-terminal fashion moment into a cinematic outdoor fashion scene. Guide the camera past two subjects, matching their positions and movement across a smooth scene transition.' },
  { id:'street-style-adventure', name:'STREET STYLE ADVENTURE', category:'FASHION', aspect:'9:16', previewAspect:'9 / 16', bg:'linear-gradient(155deg,#42203b,#be467d,#efc76b)', action:'Follow a bright fashion character through playful outdoor city moments, from a picnic setup to a scooter beside modern architecture. Keep wardrobe, lighting and identity cohesive as the camera moves.' },
];
export const SOURCE_TEMPLATE_EXPANSION_7 = recipes.map(({action,...recipe}) => ({
  ...base, ...recipe, clipKey: recipe.id, steps,
  needs: 'A clear photo. The example is inspiration; generation uses your image and does not copy its exact motion.',
  prompt: `Animate the uploaded image into a polished ten-second ${recipe.name.toLowerCase()} sequence. Preserve the subject’s identity and proportions. ${action} Use smooth movement, stable anatomy, natural lighting and no added captions, logos or watermark.`,
}));
export const SHOWCASE_CLIP_EXPANSION_7 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_7.map((entry) => [entry.clipKey, {
  video: `/showcase/viral-${entry.id}.mp4`, poster: `/showcase/viral-${entry.id}.jpg`, aspectRatio: entry.previewAspect,
  title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
