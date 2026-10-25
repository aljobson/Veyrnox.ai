const feature = (definition) => Object.freeze(definition);

// Exact public template/example media shown on the corresponding LipSync.video
// pages during the 2026-10-25 reference audit. Keep the source page beside the
// asset so the UI is transparent about provenance and reviewers can re-check it.
export const CREATIVE_FEATURE_EXAMPLES = Object.freeze({
  'ai-avatar-generator': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-avatar-genetator/howto/portrait-transformed-into-a-reusable-digital-presenter-with-the-same-identity.webp' },
  'talking-avatar': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/talking-avatar/sample-display/Talkingavatarvideoforeducation_01.webm' },
  'ai-human-generator': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-human-generator/example/AI-Human-Social-Influencer-Video-Example.mp4' },
  'ai-influencer-generator': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-influencer-generator/preview/beauty-ai-influencer-video.mp4' },
  'text-to-speech': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/text-to-speech/Convert-text-to-natural-AI-speech.webp' },
  'ai-voice-cloning': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-voice-cloning/introduction.webp' },
  'ai-hairstyle-changer': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-hair-style-changer/hairstyle-templates/Bob_Cut.webp' },
  'ai-hair-color-changer': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-hair-color-changer/function-area/ai-hair-color-changer-sample-after.webp' },
  'ai-baby-generator': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-baby-generator/Sample-of-a-baby-generated.webp' },
  'lip-sync': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/cdn/template/preview/studio/studio_19_preview.webp?x-oss-process=image/resize,l_144' },
  'ai-talking-photo-generator': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/talkingPhoto-1/examples/Turn-portrait-to-talking-video.mp4' },
  'singing-photo': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/sing-photo/singing-3-example-video.webm' },
  'avatar-dialogue': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/avatar-dialogue/H1-showcase-video.webm' },
  'video-dubbing': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-dubbing/template/video-English.mp4' },
  'talking-cartoon': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/talking-cartoon/video-sample/Talking-Cartoon-Demo1.mp4' },
  'talking-animals': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/talking-animals/sample-display/talkingcatvideo.webm' },
  'ai-baby-podcast': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-baby-podcast/Baby-Podcast.mp4' },
  'talking-objects': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/talking-objects/talking-object-video-first-frame.webp?x-oss-process=image/resize,w_800/format,webp' },
  'ai-ad-clone': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/ai-ad-clone/hero/preview-video.webm' },
  'product-avatar': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/product-avatar/3-examples-of-product-avatar-video.mp4' },
  'product-video-generator': { kind: 'video', url: 'https://cdn.lipsync.video/lipsync/web/assets/product-video-generator/AI-generated-creative-soda-advertisement.webm' },
  'product-image-generator': { kind: 'image', url: 'https://cdn.lipsync.video/lipsync/web/assets/product-image-generator/AI-Product-Image-Generator.webp' },
});

export function creativeFeatureExample(slug) {
  const example = CREATIVE_FEATURE_EXAMPLES[slug];
  return example ? { ...example, sourceUrl: `https://lipsync.video/${slug === 'lip-sync' ? '' : slug}` } : null;
}

export function creativeFeatureExampleAssetPath(slug) {
  return CREATIVE_FEATURE_EXAMPLES[slug]?.url || null;
}

export const CREATIVE_FEATURES = Object.freeze([
  feature({ slug: 'ai-avatar-generator', title: 'AI Avatar Generator', group: 'Avatars', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'Describe the avatar', placeholder: 'A warm, confident presenter in a modern studio…', prompt: 'Use the supplied reference image to create an original, photorealistic avatar. Preserve only the traits the user requests and keep the result brand-safe. ', steps: ['Upload a reference image you may use', 'Describe the avatar and framing', 'Generate and save the avatar'] }),
  feature({ slug: 'talking-avatar', title: 'Talking Avatar', group: 'Avatars', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Performance direction', placeholder: 'Friendly delivery, steady eye contact and natural gestures…', prompt: 'Animate the supplied avatar speaking the supplied audio. Preserve identity and framing. ', steps: ['Add an avatar image', 'Add speech audio up to 10 seconds', 'Generate the performance'] }),
  feature({ slug: 'ai-human-generator', title: 'AI Human Generator', group: 'Avatars', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'Describe the person', placeholder: 'An original documentary photographer, natural window light…', prompt: 'Use the supplied reference image as visual direction to create a fictional adult human. Use realistic anatomy, skin texture and lighting without resembling a named real person. ', steps: ['Upload a visual reference you may use', 'Describe a fictional adult and composition', 'Generate the portrait'] }),
  feature({ slug: 'ai-influencer-generator', title: 'AI Influencer Generator', group: 'Avatars', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'Describe the creator persona', placeholder: 'A fictional travel creator with a bright editorial look…', prompt: 'Use the supplied reference image as visual direction to create an original fictional creator persona for a social campaign. Do not imitate a real influencer. ', steps: ['Upload a visual reference you may use', 'Define the persona and campaign look', 'Generate the hero portrait'] }),
  feature({ slug: 'text-to-speech', title: 'Text to Speech', group: 'Voice', model: 'elevenlabs-tts-turbo', kind: 'audio', media: [], scriptUpload: true, input: 'Script', placeholder: 'Upload a TXT or Markdown script, then refine the words here…', prompt: '', steps: ['Upload a TXT or Markdown script', 'Review or refine up to 1,000 characters', 'Generate the speech track'] }),
  feature({ slug: 'ai-voice-cloning', title: 'AI Voice Cloning', group: 'Voice', model: 'zonos2-voice-clone', kind: 'audio', media: ['audio'], input: 'Words to speak', placeholder: 'Type what the cloned voice should say…', prompt: '', steps: ['Upload a clear voice sample you may use', 'Write the words for the cloned voice', 'Generate and review the speech'] }),
  feature({ slug: 'ai-hairstyle-changer', title: 'AI Hairstyle Changer', group: 'Photo', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'New hairstyle', placeholder: 'Shoulder-length layered bob with soft curtain fringe…', prompt: 'Edit only the hairstyle in the supplied portrait. Preserve the person’s identity, face, expression, clothing, pose and background. Requested hairstyle: ', steps: ['Upload a portrait you may edit', 'Describe the new hairstyle', 'Generate the edited portrait'] }),
  feature({ slug: 'ai-hair-color-changer', title: 'AI Hair Color Changer', group: 'Photo', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'New hair colour', placeholder: 'Deep copper auburn with natural highlights…', prompt: 'Change only the hair colour in the supplied portrait. Preserve identity, hairstyle, face, clothing, pose and background. Requested colour: ', steps: ['Upload a portrait you may edit', 'Describe the colour and finish', 'Generate the edited portrait'] }),
  feature({ slug: 'ai-baby-generator', title: 'AI Baby Generator', group: 'Photo', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'Describe the fictional baby portrait', placeholder: 'A cheerful fictional baby in a soft storybook nursery…', prompt: 'Use the supplied reference image only for permitted visual direction. Create a clearly fictional, family-safe baby portrait and do not infer or claim a real child’s future appearance. ', steps: ['Upload a reference image you may use', 'Describe a family-safe fictional scene', 'Generate the fictional portrait'] }),
  feature({ slug: 'lip-sync', title: 'AI Lip Sync', group: 'Performance', model: 'latentsync', kind: 'video', media: ['video', 'audio'], input: 'Production note', placeholder: 'Match the new speech naturally while preserving the original performance…', prompt: 'Synchronise the supplied video to the supplied speech track. ', steps: ['Upload a video up to 40 seconds', 'Upload speech no longer than the video', 'Generate the synchronised video'] }),
  feature({ slug: 'ai-talking-photo-generator', title: 'AI Talking Photo Generator', group: 'Performance', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Performance direction', placeholder: 'Natural eye contact, subtle breathing and a calm delivery…', prompt: 'Turn the supplied photo into a natural speaking performance using the supplied audio. ', steps: ['Upload a clear photo', 'Upload speech up to 10 seconds', 'Generate the talking photo'] }),
  feature({ slug: 'singing-photo', title: 'Singing Photo', group: 'Performance', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Singing performance direction', placeholder: 'Expressive pop performance with restrained head movement…', prompt: 'Animate the supplied photo singing the supplied vocal recording. Preserve identity and match mouth movement to the recording. ', steps: ['Upload a clear photo', 'Upload an owned vocal recording', 'Generate the singing performance'] }),
  feature({ slug: 'avatar-dialogue', title: 'Avatar Dialogue', group: 'Performance', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Dialogue performance direction', placeholder: 'Conversational delivery with natural pauses and attentive eye contact…', prompt: 'Animate the supplied avatar delivering the supplied dialogue recording. Preserve identity and natural facial motion. ', steps: ['Create or upload dialogue audio', 'Upload the avatar image', 'Generate the dialogue performance'] }),
  feature({ slug: 'video-dubbing', title: 'Video Dubbing', group: 'Performance', model: 'latentsync', kind: 'video', media: ['video', 'audio'], input: 'Dubbing note', placeholder: 'Neutral English dub, preserve the timing and emotional intensity…', prompt: 'Dub the supplied video with the supplied replacement speech. Preserve shot timing and synchronise visible speech. ', steps: ['Prepare the translated speech track', 'Upload the source video and new audio', 'Generate the dubbed video'] }),
  feature({ slug: 'talking-cartoon', title: 'Talking Cartoon', group: 'Characters', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Performance direction', placeholder: 'Energetic cartoon delivery with clean readable mouth shapes…', prompt: 'Animate the supplied cartoon character speaking the supplied audio. Preserve the illustration style and character design. ', steps: ['Upload a cartoon character', 'Upload speech audio', 'Generate the performance'] }),
  feature({ slug: 'talking-animals', title: 'Talking Animals', group: 'Characters', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Performance direction', placeholder: 'Playful delivery with restrained, believable movement…', prompt: 'Animate the supplied animal character speaking the supplied audio. Preserve the animal’s appearance and keep motion family-safe. ', steps: ['Upload an animal image you may use', 'Upload speech audio', 'Generate the performance'] }),
  feature({ slug: 'ai-baby-podcast', title: 'AI Baby Podcast', group: 'Characters', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Podcast performance direction', placeholder: 'Playful fictional podcast host, gentle gestures, studio framing…', prompt: 'Animate the supplied fictional baby character as a family-safe podcast host using the supplied audio. Do not depict a real child. ', steps: ['Create a fictional host image', 'Create or upload the podcast audio', 'Generate the podcast clip'] }),
  feature({ slug: 'talking-objects', title: 'Talking Objects', group: 'Characters', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Performance direction', placeholder: 'A cheerful product mascot with subtle squash-and-stretch motion…', prompt: 'Animate the supplied object speaking the supplied audio. Preserve its recognisable shape, materials and branding rights. ', steps: ['Upload an object image', 'Upload speech audio', 'Generate the performance'] }),
  feature({ slug: 'ai-ad-clone', title: 'AI Ad Clone', group: 'Commerce', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'Original campaign direction', placeholder: 'Rebuild this layout for a winter launch using our own colours and copy space…', prompt: 'Create an original advertisement inspired only by the supplied composition. Do not copy protected logos, people, text or distinctive brand assets. Campaign direction: ', steps: ['Upload a reference you may use', 'Describe an original campaign direction', 'Generate the new key visual'] }),
  feature({ slug: 'product-avatar', title: 'Product Avatar', group: 'Commerce', model: 'kling-avatar-v2', kind: 'video', media: ['image', 'audio'], input: 'Product presenter direction', placeholder: 'Confident product introduction with a clean studio background…', prompt: 'Animate the supplied product presenter image delivering the supplied audio. Preserve the product and presenter accurately. ', steps: ['Prepare a presenter-and-product image', 'Upload the product script audio', 'Generate the product presentation'] }),
  feature({ slug: 'product-video-generator', title: 'Product Video Generator', group: 'Commerce', model: 'kling-3.0-i2v-kie', kind: 'video', media: ['image'], input: 'Product video brief', placeholder: 'Slow premium orbit, crisp reflections and a clean hero reveal…', prompt: 'Create an original product video from the supplied product image. Preserve product geometry, labels and materials. ', steps: ['Upload a clean product image', 'Describe camera and lighting', 'Generate the product clip'] }),
  feature({ slug: 'product-image-generator', title: 'Product Image Generator', group: 'Commerce', model: 'nano-banana-pro-edit-grsai', kind: 'image', media: ['image'], input: 'Product image brief', placeholder: 'A premium skincare bottle on pale stone with soft morning light…', prompt: 'Use the supplied product image to create an original commercial composition. Preserve product geometry and supplied labels, and avoid third-party branding. ', steps: ['Upload a clean product image', 'Describe the setting and composition', 'Generate the product image'] }),
]);

export const CREATIVE_FEATURE_SLUGS = Object.freeze(CREATIVE_FEATURES.map((item) => item.slug));

export function creativeFeature(slug) {
  return CREATIVE_FEATURES.find((item) => item.slug === slug) || null;
}

export function creativeFeatureGroups() {
  return [...new Set(CREATIVE_FEATURES.map((item) => item.group))].map((group) => ({
    group,
    features: CREATIVE_FEATURES.filter((item) => item.group === group),
  }));
}

export function translatedCreativeFeature(item, t) {
  const base = `app.features.items.${item.slug}`;
  const translated = (field, fallback) => t.messages?.[`${base}.${field}`] ? t(`${base}.${field}`) : fallback;
  return {
    ...item,
    title: translated('title', item.title),
    group: translated('group', item.group),
    input: translated('input', item.input),
    placeholder: translated('placeholder', item.placeholder),
    prompt: translated('prompt', item.prompt),
    blockedReason: item.blockedReason ? translated('blockedReason', item.blockedReason) : undefined,
    steps: item.steps.map((step, index) => translated(`step${index + 1}`, step)),
  };
}
