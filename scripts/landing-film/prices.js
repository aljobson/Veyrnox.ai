// Every price the landing film shows, keyed by catalog id. Read from the live
// catalog (GET /api/catalog) on 2026-10-09, names as shelfName() prints them.
// tests/landingFilm.test.mjs fails when one of these stops matching the
// landing page's fallback list, which is the cue to render the film again.

(() => {
  const row = (id, name, credits) => ({ id, name, credits });
  window.FilmPrices = [
    ['Video', [
      row('wan-2.5-kie', 'Wan 2.5', 19), row('kling-2.6-pro-kie', 'Kling 2.6 Pro', 17),
      row('seedance-2.0-fast', 'Seedance 2.0', 28), row('veo-3.1-fast-kie', 'Veo 3.1 Fast', 19),
      row('veo-3.1-lite-kie', 'Veo 3.1 Lite', 10), row('hailuo-02-kie', 'MiniMax Hailuo 02', 9),
    ]],
    ['Image', [
      row('nano-banana-kie', 'Nano Banana', 2), row('nano-banana-pro-grsai', 'Nano Banana Pro', 2),
      row('flux-2-pro', 'Flux.2 [pro]', 2), row('seedream-4', 'Seedream v4', 2), row('sana-1.5-4.8b', 'Sana v1.5 4.8B', 1),
    ]],
    ['Audio', [
      row('ace-step', 'ACE-Step', 1), row('elevenlabs-sfx-v2', 'ElevenLabs Sound Effects v2', 2),
      row('inworld-tts', 'Inworld TTS', 2), row('elevenlabs-tts-turbo', 'ElevenLabs TTS Turbo 2.5', 4),
    ]],
  ];
})();
