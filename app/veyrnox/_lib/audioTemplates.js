// Audio templates: music, voice-over and sound effects. Original prompts (no captured
// source), no brand, artist or real person, no cloned voice. Draft approved by the owner
// in chat on 2026-11-09 (docs/drafts/audio-templates-first-30.md).
//
// Kept apart from PRESETS on purpose: PRESETS is the video gallery and every entry needs
// a video preview, a video category and a route contract. An audio template carries a
// model id and a prompt only. It carries no price: clients price from the live catalog
// (CLAUDE.md, "Money & billing"). Not yet listed on any surface.

export const AUDIO_CATEGORIES = Object.freeze(['MUSIC', 'VOICE-OVER', 'SOUND FX']);

const music = (id, name, prompt) => ({ id: `audio-${id}`, name, category: 'MUSIC', kind: 'music', modelId: 'ace-step-1.5', prompt });
const sfx = (id, name, prompt) => ({ id: `audio-${id}`, name, category: 'SOUND FX', kind: 'sound-effect', modelId: 'elevenlabs-sfx-v2', prompt });
const ambience = (id, name, prompt, negativePrompt) => ({
  id: `audio-${id}`, name, category: 'SOUND FX', kind: 'sound-effect', modelId: 'mmaudio-v2', prompt, ...(negativePrompt ? { negativePrompt } : {}),
});
const voice = (id, name, prompt) => ({ id: `audio-${id}`, name, category: 'VOICE-OVER', kind: 'voice-over', modelId: 'inworld-tts', prompt });

export const AUDIO_TEMPLATES = Object.freeze([
  music('lofi-study-loop', 'LO-FI STUDY LOOP', 'Warm lo-fi hip hop, 76 BPM, dusty vinyl crackle, mellow electric piano, soft brushed drums, gentle bass, instrumental, seamless loop feel.'),
  music('trailer-build', 'CINEMATIC TRAILER BUILD', 'Epic cinematic trailer score, slow tense build over 60 seconds, low strings and taiko drums, rising brass, huge final hit, instrumental.'),
  music('vlog-bed', 'UPBEAT VLOG BED', 'Bright upbeat pop instrumental, 118 BPM, clapping, plucky guitar, light synth bass, cheerful and clean, no vocals, sits under speech.'),
  music('corporate-explainer', 'CORPORATE EXPLAINER', 'Clean modern corporate background music, 100 BPM, soft piano, light percussion, optimistic and calm, instrumental, easy to talk over.'),
  music('horror-drone', 'HORROR DRONE', 'Dark horror ambience, deep sub drone, detuned strings, distant metallic scrapes, slow creeping tension, no melody, instrumental.'),
  music('synthwave-night-drive', 'SYNTHWAVE NIGHT DRIVE', 'Retro synthwave, 108 BPM, analog arpeggios, gated reverb snare, warm pads, neon night drive mood, instrumental.'),
  music('acoustic-birthday', 'ACOUSTIC BIRTHDAY', 'Cheerful acoustic birthday song feel, strummed guitar, handclaps, glockenspiel, 120 BPM, warm and playful, instrumental.'),
  music('epic-fantasy', 'EPIC FANTASY THEME', 'Sweeping fantasy orchestral theme, French horn melody, harp, choir pads, hopeful journey, medium tempo, instrumental.'),
  music('ad-jingle', 'AD JINGLE', 'Short catchy upbeat jingle, major key, whistling hook, ukulele and bells, bouncy and friendly, instrumental, resolves with a clear ending.'),
  music('calm-meditation', 'CALM MEDITATION', 'Slow ambient meditation music, soft sine pads, distant singing bowls, gentle breathing rhythm, very spacious, no drums, instrumental.'),

  sfx('whoosh-transitions', 'WHOOSH TRANSITIONS', 'Three fast cinematic whooshes in a row, short and clean, rising air sweep each time, no music, no voice.'),
  sfx('ui-clicks', 'APP UI CLICKS', 'A set of clean soft app interface sounds: tap, toggle on, toggle off, success chime, error buzz, each separated by silence.'),
  sfx('gravel-footsteps', 'GRAVEL FOOTSTEPS', 'One person walking slowly on loose gravel, steady pace, close microphone, no other sounds.'),
  ambience('rain-and-thunder', 'RAIN AND THUNDER', 'Steady heavy rain on a window with one distant rolling thunder halfway through.', 'music, speech'),
  sfx('scifi-door', 'SCI-FI DOOR', 'A heavy sci-fi automatic door sliding open with a pneumatic hiss and a low servo hum, then closing.'),
  sfx('crowd-cheer', 'CROWD CHEER', 'A stadium crowd erupting into a loud cheer and applause, building then fading.'),
  sfx('sword-clash', 'SWORD CLASH', 'Two metal swords clashing three times with bright ringing, then one scrape, dry and close.'),
  sfx('glass-break', 'GLASS BREAK', 'A single drinking glass falling and shattering on a tile floor, with small shards settling afterwards.'),
  ambience('city-ambience', 'CITY AMBIENCE', 'Busy city street ambience, distant traffic, a horn, muffled voices, a siren passing far away.', 'music, speech'),
  sfx('camera-shutter', 'CAMERA SHUTTER', 'A mechanical camera shutter clicking five times quickly, then one slow click with the mirror flapping.'),

  voice('product-ad', 'PRODUCT AD READ', 'Meet the lamp that follows your day. Warm in the morning, cool at noon, soft at night. One touch, no apps, no fuss. Light that knows what time it is.'),
  voice('trailer-narrator', 'TRAILER NARRATOR', 'In a world that never sleeps, one signal went dark. Now, a stranger has until sunrise to bring it back. This winter, everything changes.'),
  voice('tutorial-walkthrough', 'TUTORIAL WALKTHROUGH', "First, open Settings and tap Account. Next, choose Backup, then switch it on. That's it. Your files now save automatically."),
  voice('podcast-intro', 'PODCAST INTRO', "Welcome back to the show, the place where small ideas turn into big conversations. I'm your host, and today we're talking about starting before you're ready."),
  voice('kids-story', 'KIDS STORY', 'Once upon a time, in a tiny village under a big blue hill, lived a little fox named Pip. Every evening, Pip counted the stars. And every evening, there was one more.'),
  voice('news-bulletin', 'NEWS BULLETIN', 'Good evening. Our top story: the city council has approved a new riverside park, with work due to begin next spring. We go live now for more.'),
  voice('social-hook', 'SOCIAL HOOK', "Stop scrolling. You're about to waste less time on this than you do on your inbox, and you'll actually learn something. Here's how."),
  voice('audiobook-line', 'AUDIOBOOK LINE', 'The corridor was longer than she remembered. At the far end, a single door stood open, and behind it, the lamp was still burning.'),
  voice('hold-message', 'HOLD MESSAGE', 'Thank you for calling. Your call is important to us. Please stay on the line and the next available team member will be with you shortly.'),
  voice('documentary-intro', 'DOCUMENTARY INTRO', 'Every year, millions of birds cross the ocean in the dark, guided by nothing but the stars and the pull of the earth itself. This is their story.'),
]);

export const audioTemplateById = (id) => AUDIO_TEMPLATES.find((t) => t.id === id) || null;
export const audioTemplatesIn = (category) => (category === 'ALL' ? AUDIO_TEMPLATES : AUDIO_TEMPLATES.filter((t) => t.category === category));
