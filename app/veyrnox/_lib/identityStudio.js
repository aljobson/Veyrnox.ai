export const IDENTITY_STUDIO_MODES = Object.freeze({
  'synthetic-avatar': Object.freeze({
    recipe: 'synthetic-avatar',
    eyebrow: 'AVATAR STUDIO · ORIGINAL IDENTITY',
    title: 'One identity. More than one look.',
    description: 'Design an original fictional adult or use a permitted adult portrait, bind a stock voice, save the visual canon, and reuse the profile across future portraits and talking videos.',
    scenarioLabel: 'First look',
    defaultAspect: '9:16',
    aspects: ['9:16', '1:1', '16:9'],
    durationOptions: [],
    primaryLabel: 'Open Create with this avatar',
    performanceLabel: 'Use saved avatar in Talking Avatar',
    performanceHref: '/app/talking-avatar?recipe=talking-avatar',
    sceneInstruction: 'Create a clean reusable identity portrait suitable for later animation.',
  }),
  'synthetic-presenter': Object.freeze({
    recipe: 'synthetic-presenter',
    eyebrow: 'HUMAN STUDIO · SHORT PRESENTER SCENE',
    title: 'Direct a believable digital presenter.',
    description: 'Plan an original or consented adult presenter, choose the scene and framing, save the identity, then create the approved portrait before animating it with speech.',
    scenarioLabel: 'Presenter scenario',
    defaultAspect: '16:9',
    aspects: ['Auto', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9'],
    durationOptions: [5, 10],
    primaryLabel: 'Create presenter portrait',
    performanceLabel: 'Animate saved presenter',
    performanceHref: '/app/talking-avatar?recipe=talking-avatar',
    sceneInstruction: 'Frame a short presenter scene with natural posture and clear room for later speech animation.',
  }),
  'synthetic-creator': Object.freeze({
    recipe: 'synthetic-creator',
    eyebrow: 'CREATOR STUDIO · DISCLOSED SYNTHETIC PERSONA',
    title: 'Build a creator people can recognize.',
    description: 'Define an original disclosed creator identity, content niche, platform framing and stock voice, then reuse the same passport across campaigns and social posts.',
    scenarioLabel: 'Content lane',
    defaultAspect: '9:16',
    aspects: ['9:16', '1:1', '16:9'],
    durationOptions: [5, 10],
    primaryLabel: 'Create creator portrait',
    performanceLabel: 'Make an influencer video',
    performanceHref: '/app/talking-avatar?recipe=talking-avatar',
    sceneInstruction: 'Use a credible creator-style composition that remains clearly synthetic and avoids false endorsements.',
  }),
});

export const PRESENTER_SCENARIOS = Object.freeze([
  { id: 'human-social', label: 'Social influencer', brief: 'confident social host, expressive but natural gestures, creator-style setting, direct audience connection' },
  { id: 'human-corporate', label: 'Corporate presenter', brief: 'polished workplace presenter, composed posture, restrained modern office, clear professional delivery' },
  { id: 'human-educator', label: 'Online educator', brief: 'approachable instructor, warm study environment, encouraging expression, uncluttered teaching composition' },
  { id: 'human-news', label: 'News anchor', brief: 'formal studio anchor, poised posture, balanced newsroom-inspired setting without copied branding or logos' },
]);

export const IDENTITY_STARTERS = Object.freeze({
  'news-presenter': Object.freeze({
    id: 'news-presenter',
    recipe: 'synthetic-presenter',
    name: 'Mira Vale',
    role: 'Disclosed synthetic news presenter',
    appearance: 'Original fictional adult presenter with short dark hair, a navy studio jacket, calm direct expression, balanced key light and a clear waist-up newsroom composition.',
    canon: 'Keep the short dark hair, navy jacket, calm direct expression and balanced studio lighting consistent. Do not copy a real broadcaster, newsroom brand or channel identity.',
    lookLabel: 'News studio',
    scenarioId: 'human-news',
    aspect: '16:9',
    durationSeconds: 10,
    speechPlan: 'stock',
  }),
});

export const CREATOR_SCENARIOS = Object.freeze([
  { id: 'creator-product', label: 'Product educator', brief: 'clear product explainer energy, honest demonstration posture, neutral set with room for approved product inserts' },
  { id: 'creator-style', label: 'Style curator', brief: 'editorial creator portrait, distinctive original styling, confident pose, clean vertical social composition' },
  { id: 'creator-community', label: 'Community host', brief: 'welcoming community presenter, conversational expression, warm contemporary background, accessible framing' },
  { id: 'creator-founder', label: 'Founder diary', brief: 'thoughtful founder-style update, natural workspace, candid but polished delivery, direct eye contact' },
]);

export function identityStudioMode(recipe) {
  return IDENTITY_STUDIO_MODES[recipe] || IDENTITY_STUDIO_MODES['synthetic-avatar'];
}

export function scenariosForIdentityRecipe(recipe, avatarScenarios = []) {
  if (recipe === 'synthetic-presenter') return PRESENTER_SCENARIOS;
  if (recipe === 'synthetic-creator') return CREATOR_SCENARIOS;
  return avatarScenarios;
}

export function identityStarter(id, recipe) {
  const starter = IDENTITY_STARTERS[id];
  return starter?.recipe === recipe ? starter : null;
}

export function buildIdentityWorkflowPrompt({ prompt, recipe, aspect, durationSeconds, speechPlan } = {}) {
  const mode = identityStudioMode(recipe);
  const framing = aspect && aspect !== 'Auto' ? `${aspect} composition.` : 'Choose the composition that best fits the scene.';
  const timing = durationSeconds ? `Plan visual continuity for a provider-supported ${durationSeconds}-second follow-up animation.` : '';
  const speech = speechPlan === 'stock' ? 'Keep the face and mouth unobstructed for stock-voice animation after the portrait is approved.' : '';
  return [prompt, mode.sceneInstruction, framing, timing, speech].filter(Boolean).join(' ');
}
