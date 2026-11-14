export const RECIPE_STATUSES = Object.freeze({
  LIVE: 'live',
  PREVIEW: 'preview',
  EXPERIMENTAL: 'experimental',
  PLANNED: 'planned',
  BLOCKED: 'blocked',
});

export const RECIPE_FAMILIES = Object.freeze([
  { id: 'performance', label: 'Performance', icon: 'performance' },
  { id: 'identity', label: 'Identity', icon: 'identity' },
  { id: 'speech', label: 'Speech', icon: 'speech' },
  { id: 'transformation', label: 'Transformation', icon: 'transformation' },
  { id: 'characters', label: 'Character recipes', icon: 'characters' },
  { id: 'product', label: 'Product creative', icon: 'product' },
]);

const sharedSpeechSteps = ['Choose a source', 'Add text, audio, or a recording', 'Review the model and quote', 'Render and reuse the result'];

export const CREATION_RECIPES = Object.freeze([
  {
    id: 'synthetic-avatar', family: 'identity', title: 'Synthetic avatar', status: 'live', icon: 'identity',
    description: 'Create an original fictional presenter from a prompt or an image you have rights to use.',
    outputKind: 'image', href: '/app/avatar?recipe=synthetic-avatar', sourceSlots: ['Reference image (optional)', 'Appearance brief'],
    steps: ['Choose photo or prompt', 'Define an original adult identity', 'Generate variants', 'Save source lineage'],
    rights: ['likeness'], riskLevel: 'guarded',
  },
  {
    id: 'talking-avatar', family: 'performance', title: 'Talking avatar', status: 'live', icon: 'performance',
    description: 'Reuse a saved avatar passport and its stock voice with an approved portrait, script, uploaded audio, or browser recording.',
    outputKind: 'video', href: '/app/talking-avatar?recipe=talking-avatar', sourceSlots: ['Avatar passport', 'Approved portrait', 'Speech'],
    steps: ['Choose or create an avatar passport', 'Add its approved portrait', 'Add text, audio, or a recording', 'Review the quote and render'], rights: ['likeness', 'audio'], riskLevel: 'guarded',
  },
  {
    id: 'synthetic-presenter', family: 'identity', title: 'Synthetic presenter', status: 'live', icon: 'identity',
    description: 'Generate a fictional adult presenter for education, news-style, or product scenes.',
    outputKind: 'video', href: '/app/avatar?recipe=synthetic-presenter', sourceSlots: ['Reference image (optional)', 'Scenario brief'],
    steps: ['Describe the presenter', 'Choose format and length', 'Generate a short scene', 'Continue in Performance'],
    rights: ['likeness'], riskLevel: 'guarded',
  },
  {
    id: 'news-presenter', family: 'identity', title: 'News presenter', status: 'live', icon: 'identity',
    description: 'Start with an original fictional studio presenter, save its local identity passport and stock voice, then animate reviewed updates without copying a real broadcaster or newsroom.',
    outputKind: 'video', href: '/app/avatar?recipe=synthetic-presenter&starter=news-presenter', sourceSlots: ['Original or permitted adult identity', 'Reviewed script or owned speech'],
    steps: ['Review the fictional presenter starter', 'Create and save the approved portrait', 'Continue to talking-avatar Performance', 'Confirm the script, disclosure and live quote'],
    rights: ['likeness', 'script', 'disclosure'], riskLevel: 'guarded',
  },
  {
    id: 'synthetic-creator', family: 'identity', title: 'Synthetic creator', status: 'live', icon: 'identity',
    description: 'Build a disclosed fictional creator identity for repeatable social content.',
    outputKind: 'video', href: '/app/avatar?recipe=synthetic-creator', sourceSlots: ['Original identity', 'Creator brief'],
    steps: ['Create a fictional identity', 'Set a content role', 'Generate a scene', 'Disclose synthetic media'],
    rights: ['likeness', 'disclosure'], riskLevel: 'guarded',
  },
  {
    id: 'stock-voice', family: 'speech', title: 'Text to speech', status: 'live', icon: 'speech',
    description: 'Turn a script into downloadable speech with an approved stock voice.',
    outputKind: 'audio', href: '/app/text-to-speech?recipe=stock-voice', sourceSlots: ['Script', 'Stock voice'],
    steps: ['Write the script', 'Choose a stock voice', 'Review the exact price', 'Generate and download'],
    rights: ['script'], riskLevel: 'standard',
  },
  {
    id: 'voice-profile', family: 'speech', title: 'Voice profile', status: 'blocked', icon: 'blocked',
    description: 'Reusable voice cloning is unavailable under the current Veyrnox.ai policy.',
    outputKind: 'audio', href: null, sourceSlots: ['Voice sample', 'Consent evidence'],
    steps: ['Policy approval', 'Strong identity verification', 'Consent and revocation', 'Provider-side deletion'],
    rights: ['voice', 'consent'], riskLevel: 'prohibited', blockedReason: 'Voice cloning is prohibited by the current Acceptable Use Policy.',
  },
  {
    id: 'synthetic-hairstyle', family: 'transformation', title: 'Hairstyle study', status: 'live', icon: 'transformation',
    description: 'Explore independently designed hairstyle directions on fictional adults or permitted portraits.',
    outputKind: 'image', href: '/app/hairstyle?recipe=synthetic-hairstyle', sourceSlots: ['Portrait', 'Style direction'],
    steps: ['Choose a permitted portrait', 'Pick a style direction', 'Preserve identity and framing', 'Generate an edit'],
    rights: ['likeness'], riskLevel: 'guarded',
  },
  {
    id: 'synthetic-hair-colour', family: 'transformation', title: 'Hair colour study', status: 'live', icon: 'transformation',
    description: 'Test named or custom hair colours while preserving the subject and framing.',
    outputKind: 'image', href: '/app/hair-colour?recipe=synthetic-hair-colour', sourceSlots: ['Portrait', 'Colour direction'],
    steps: ['Choose a permitted portrait', 'Set a colour', 'Preserve identity and lighting', 'Generate an edit'],
    rights: ['likeness'], riskLevel: 'guarded',
  },
  {
    id: 'minor-portrait', family: 'identity', title: 'Child portrait generator', status: 'blocked', icon: 'blocked',
    description: 'Minor-centred identity generation is unavailable while the child-safety policy is unresolved.',
    outputKind: 'image', href: null, sourceSlots: ['Parent references'], steps: ['Adopt policy', 'Design guardian consent', 'Add abuse controls', 'Independent safety review'],
    rights: ['minor', 'guardian-consent'], riskLevel: 'prohibited', blockedReason: 'Veyrnox.ai has not adopted the safeguards required for minor-centred generation.',
  },
  {
    id: 'lip-sync', family: 'performance', title: 'Video lip sync', status: 'live', icon: 'performance',
    description: 'Replace speech in a short video while keeping the original performance.',
    outputKind: 'video', href: '/app/lip-sync?recipe=lip-sync&workflow=video-lip-sync', sourceSlots: ['Source video', 'Speech'],
    steps: sharedSpeechSteps, rights: ['likeness', 'performance', 'audio'], riskLevel: 'guarded',
  },
  {
    id: 'talking-photo', family: 'performance', title: 'Talking photo', status: 'live', icon: 'performance',
    description: 'Animate one permitted portrait from text, uploaded audio, or a recording.',
    outputKind: 'video', href: '/app/lip-sync?recipe=talking-photo&workflow=talking-photo', sourceSlots: ['Portrait', 'Speech'],
    steps: sharedSpeechSteps, rights: ['likeness', 'audio'], riskLevel: 'guarded',
  },
  {
    id: 'singing-photo', family: 'performance', title: 'Singing photo', status: 'live', icon: 'performance',
    description: 'Align a cleared song clip to one permitted portrait with an honest 10-second model limit.',
    outputKind: 'video', href: '/app/singing-photo?recipe=singing-photo', sourceSlots: ['Performer portrait', 'Cleared song clip'],
    steps: ['Verify music rights', 'Choose one portrait', 'Upload or record a song clip', 'Render and review the performance'],
    rights: ['likeness', 'music', 'performance'], riskLevel: 'high',
  },
  {
    id: 'avatar-dialogue', family: 'performance', title: 'Avatar dialogue', status: 'live', icon: 'dialogue',
    description: 'Create reusable multi-speaker audio or animate two adults in one permitted photo.',
    outputKind: 'video', href: '/app/dialogue?recipe=avatar-dialogue', sourceSlots: ['Two-person portrait', 'Two written parts', 'Stock voices'],
    steps: ['Choose audio or two-person photo', 'Write the speaker parts', 'Confirm portrait permission', 'Review the pinned quote and render'],
    rights: ['likeness', 'script', 'voice'], riskLevel: 'guarded',
  },
  {
    id: 'video-dubbing', family: 'performance', title: 'Video dubbing', status: 'live', icon: 'localize',
    description: 'Turn a reviewed translation or owned dubbed track into a lip-synced locale version.',
    outputKind: 'video', href: '/app/video-dubbing?recipe=video-dubbing', sourceSlots: ['Source video', 'Reviewed translation or dubbed audio'],
    steps: ['Choose a short source video', 'Add an approved translation or dubbed track', 'Choose a target-language stock voice', 'Review the two-job quote and render'],
    rights: ['video', 'voice', 'translation'], riskLevel: 'high',
  },
  {
    id: 'faceless-reel', family: 'performance', title: 'Faceless reel', status: 'live', icon: 'performance',
    description: 'Plan an original presenter-free short around objects, places, graphics and atmosphere, then render one caption-safe visual master.',
    outputKind: 'video', href: '/app/faceless-reel?recipe=faceless-reel', destinations: ['/app/faceless-reel', '/app/create'], sourceSlots: ['Original visual brief', 'Format, pacing and platform'],
    steps: ['Describe the visual idea', 'Choose structure and pacing', 'Set a supported frame and duration', 'Review the live quote and render'],
    rights: ['concept', 'claims', 'identity-safety'], riskLevel: 'standard',
  },
  {
    id: 'talking-cartoon', family: 'characters', title: 'Talking illustration', status: 'live', icon: 'characters',
    description: 'Test lip sync on an original illustrated character after model compatibility checks.',
    outputKind: 'video', href: '/app/talking-cartoon?recipe=talking-cartoon', sourceSlots: ['Original illustration', 'Speech'],
    steps: sharedSpeechSteps, rights: ['character', 'audio'], riskLevel: 'guarded',
  },
  {
    id: 'talking-animal', family: 'characters', title: 'Talking animal', status: 'live', icon: 'characters',
    description: 'Test speech animation on an owned or generated animal image.',
    outputKind: 'video', href: '/app/talking-animals?recipe=talking-animal', sourceSlots: ['Animal image', 'Speech'],
    steps: sharedSpeechSteps, rights: ['image', 'audio'], riskLevel: 'guarded',
  },
  {
    id: 'minor-podcast', family: 'characters', title: 'Synthetic baby podcast', status: 'live', icon: 'characters',
    description: 'Animate an original synthetic baby character without using a real child identity or voice.',
    outputKind: 'video', href: '/app/baby-podcast?recipe=minor-podcast', sourceSlots: ['Synthetic baby character', 'Adult-provided or stock speech'],
    steps: ['Verify the character is fully synthetic', 'Add a short podcast script or cleared adult audio', 'Choose a stock voice and delivery', 'Review the safety statement and render'],
    rights: ['synthetic-character', 'audio', 'adult-consent'], riskLevel: 'high',
  },
  {
    id: 'talking-object', family: 'characters', title: 'Talking object', status: 'live', icon: 'characters',
    description: 'Animate an original product, food, toy, package or everyday-object character with a clear designed face.',
    outputKind: 'video', href: '/app/talking-objects?recipe=talking-object', sourceSlots: ['Original object character', 'Speech'],
    steps: ['Choose an original object character', 'Add text, owned audio, or a recording', 'Review the experimental 10-second contract', 'Render and reuse the result'],
    rights: ['object-design', 'audio', 'brand-claims'], riskLevel: 'guarded',
  },
  {
    id: 'ad-remix', family: 'product', title: 'Ad remix', status: 'live', icon: 'product',
    description: 'Use owned product assets and a creative brief to make original variations—not copies.',
    outputKind: 'image-or-video', href: '/app/ad-remix?recipe=ad-remix', sourceSlots: ['Product assets', 'Owned reference', 'Brief'],
    steps: ['Verify asset rights', 'Extract abstract creative structure', 'Draft original variants', 'Review claims and similarity'],
    rights: ['product', 'reference', 'brand-claims'], riskLevel: 'high',
  },
  {
    id: 'product-presenter', family: 'product', title: 'Product presenter', status: 'live', icon: 'product',
    description: 'Combine an original presenter, product asset, and script in a product-faithful scene.',
    outputKind: 'video', href: '/app/product-avatar?recipe=product-presenter', sourceSlots: ['Presenter', 'Product', 'Speech'],
    steps: ['Choose presenter and product', 'Plan the interaction', 'Add speech', 'Review product fidelity'],
    rights: ['likeness', 'product', 'claims'], riskLevel: 'high', destinations: ['/app/product-avatar', '/app/product-avatar/animate'],
  },
  {
    id: 'product-motion', family: 'product', title: 'Product video', status: 'live', icon: 'product',
    description: 'Animate an owned product image with a clear motion intent and model-aware settings.',
    outputKind: 'video', href: '/app/product-video?recipe=product-motion', sourceSlots: ['Product image', 'Motion brief'],
    steps: ['Choose a product image', 'Describe motion', 'Set format and duration', 'Review the quote and generate'],
    rights: ['product', 'claims'], riskLevel: 'standard',
  },
  {
    id: 'product-packshot', family: 'product', title: 'Product image', status: 'live', icon: 'product',
    description: 'Place an owned product in an original scene with model-specific image controls.',
    outputKind: 'image', href: '/app/product-image?recipe=product-packshot', sourceSlots: ['Product image', 'Scene brief'],
    steps: ['Choose a product image', 'Describe an original scene', 'Set format and quality', 'Review the quote and generate'],
    rights: ['product', 'claims'], riskLevel: 'standard',
  },
]);

export function recipeById(id) {
  return CREATION_RECIPES.find((recipe) => recipe.id === id) || null;
}

export function recipesByFamily(family) {
  return CREATION_RECIPES.filter((recipe) => recipe.family === family);
}

export function launchableRecipe(recipe) {
  return Boolean(recipe?.href) && !['blocked'].includes(recipe.status);
}

export function recipeForDestination(id, pathname) {
  const recipe = recipeById(id);
  if (!launchableRecipe(recipe) || typeof pathname !== 'string') return null;
  const destinations = Array.isArray(recipe.destinations) && recipe.destinations.length
    ? recipe.destinations
    : [String(recipe.href).split('?')[0]];
  return destinations.includes(pathname) ? recipe : null;
}
