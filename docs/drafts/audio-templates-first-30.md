# Audio templates: first 30 (DRAFT for owner approval)

Status: draft, nothing built. Every prompt is original (no captured source), names no
brand, artist or real person, and clones no voice. Models and limits are from
`lib/modelCapabilities.js`.

| Kind | Model | Credits | Fixed length | Input |
|---|---|---|---|---|
| Music | `ace-step-1.5` | 3 | 60 s | one style prompt |
| Sound effect | `elevenlabs-sfx-v2` | 2 | 10 s | one text prompt |
| Sound effect (ambience) | `mmaudio-v2` | 1 | 8 s | prompt + optional negative |
| Voice-over | `inworld-tts` | 2 | by text | script, max 2000 chars |

Voice-over has no voice picker on `inworld-tts`, so the voice in each line below is a
hope, not a promise. Check what the model returns on staging before approving.

## Music (10)

1. **Lo-fi study loop**: Warm lo-fi hip hop, 76 BPM, dusty vinyl crackle, mellow electric piano, soft brushed drums, gentle bass, instrumental, seamless loop feel.
2. **Cinematic trailer build**: Epic cinematic trailer score, slow tense build over 60 seconds, low strings and taiko drums, rising brass, huge final hit, instrumental.
3. **Upbeat vlog bed**: Bright upbeat pop instrumental, 118 BPM, clapping, plucky guitar, light synth bass, cheerful and clean, no vocals, sits under speech.
4. **Corporate explainer**: Clean modern corporate background music, 100 BPM, soft piano, light percussion, optimistic and calm, instrumental, easy to talk over.
5. **Horror drone**: Dark horror ambience, deep sub drone, detuned strings, distant metallic scrapes, slow creeping tension, no melody, instrumental.
6. **Synthwave night drive**: Retro synthwave, 108 BPM, analog arpeggios, gated reverb snare, warm pads, neon night drive mood, instrumental.
7. **Acoustic birthday**: Cheerful acoustic birthday song feel, strummed guitar, handclaps, glockenspiel, 120 BPM, warm and playful, instrumental.
8. **Epic fantasy**: Sweeping fantasy orchestral theme, French horn melody, harp, choir pads, hopeful journey, medium tempo, instrumental.
9. **Ad jingle**: Short catchy upbeat jingle, major key, whistling hook, ukulele and bells, bouncy and friendly, instrumental, resolves with a clear ending.
10. **Calm meditation**: Slow ambient meditation music, soft sine pads, distant singing bowls, gentle breathing rhythm, very spacious, no drums, instrumental.

## Sound effects (10)

1. **Whoosh transition pack** (SFX v2): Three fast cinematic whooshes in a row, short and clean, rising air sweep each time, no music, no voice.
2. **UI clicks** (SFX v2): A set of clean soft app interface sounds: tap, toggle on, toggle off, success chime, error buzz, each separated by silence.
3. **Gravel footsteps** (SFX v2): One person walking slowly on loose gravel, steady pace, close microphone, no other sounds.
4. **Rain and thunder** (MMAudio): Steady heavy rain on a window with one distant rolling thunder halfway through.
5. **Sci-fi door** (SFX v2): A heavy sci-fi automatic door sliding open with a pneumatic hiss and a low servo hum, then closing.
6. **Crowd cheer** (SFX v2): A stadium crowd erupting into a loud cheer and applause, building then fading.
7. **Sword clash** (SFX v2): Two metal swords clashing three times with bright ringing, then one scrape, dry and close.
8. **Glass break** (SFX v2): A single drinking glass falling and shattering on a tile floor, with small shards settling afterwards.
9. **City ambience** (MMAudio): Busy city street ambience, distant traffic, a horn, muffled voices, a siren passing far away. Negative: music, speech.
10. **Camera shutter** (SFX v2): A mechanical camera shutter clicking five times quickly, then one slow click with the mirror flapping.

## Voice-over (10, all `inworld-tts`)

1. **Product ad read**: "Meet the lamp that follows your day. Warm in the morning, cool at noon, soft at night. One touch, no apps, no fuss. Light that knows what time it is."
2. **Trailer narrator**: "In a world that never sleeps, one signal went dark. Now, a stranger has until sunrise to bring it back. This winter, everything changes."
3. **Tutorial walkthrough**: "First, open Settings and tap Account. Next, choose Backup, then switch it on. That's it. Your files now save automatically."
4. **Podcast intro**: "Welcome back to the show, the place where small ideas turn into big conversations. I'm your host, and today we're talking about starting before you're ready."
5. **Kids story**: "Once upon a time, in a tiny village under a big blue hill, lived a little fox named Pip. Every evening, Pip counted the stars. And every evening, there was one more."
6. **News bulletin**: "Good evening. Our top story: the city council has approved a new riverside park, with work due to begin next spring. We go live now for more."
7. **Short social hook**: "Stop scrolling. You're about to waste less time on this than you do on your inbox, and you'll actually learn something. Here's how."
8. **Audiobook line**: "The corridor was longer than she remembered. At the far end, a single door stood open, and behind it, the lamp was still burning."
9. **Hold message**: "Thank you for calling. Your call is important to us. Please stay on the line and the next available team member will be with you shortly."
10. **Documentary intro**: "Every year, millions of birds cross the ocean in the dark, guided by nothing but the stars and the pull of the earth itself. This is their story."

## Checks before any build

- [ ] Owner approves or edits the 30 above.
- [ ] Confirm which of these catalog rows are `active = true` in production (`ace-step-1.5`, `elevenlabs-sfx-v2`, `mmaudio-v2`, `inworld-tts`).
- [ ] Hear one of each on staging: ACE-Step output is real music (not noise), Inworld's default voice suits each script.
- [ ] Preview spend cap agreed (estimate $1–2 for all 30).
- [ ] Voice-over scripts are fine as sample text (no real names, no cloned voice).
