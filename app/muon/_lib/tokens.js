// Muon v2 data constants — source of truth: platform_model.xlsx / handoff README
// Do not drift these numbers. Credit costs & plan prices are contractual.

export const MODELS = [
  { id: 'wan-25',       name: 'Wan 2.5',            credits: 15,  tag: 'RECOMMENDED', preselected: true,  kind: 'video' },
  { id: 'seedance-fast',name: 'Seedance 2.0 Fast',  credits: 5,   tag: 'FASTEST',                          kind: 'video' },
  { id: 'seedance-lite',name: 'Seedance 1.0 Lite',  credits: 8,                                            kind: 'video' },
  { id: 'hailuo-02',    name: 'Hailuo 02',          credits: 20,                                           kind: 'video' },
  { id: 'kling-26pro',  name: 'Kling 2.6 Pro',      credits: 23,                                           kind: 'video' },
  { id: 'kling-30',     name: 'Kling 3.0',          credits: 33,  tag: '4K',                               kind: 'video' },
  { id: 'veo-31',       name: 'Veo 3.1',            credits: 125, tag: 'PREMIUM',    premium: true,        kind: 'video' },
  { id: 'flux-2-pro',   name: 'Flux.2 [pro]',       credits: 3,                                            kind: 'image' },
  { id: 'seedream-45',  name: 'Seedream 4.5',       credits: 3,                                            kind: 'image' },
  { id: 'nano-banana',  name: 'Nano Banana',        credits: 5,                                            kind: 'image' },
];

// 10s video = exactly 2x credits. Non-negotiable.
export const COST_MULTIPLIER_10S = 2;

export const PLANS = [
  { id: 'starter', name: 'Starter', price: '$15', priceMo: 15, credits: 200,   creditsFmt: '200 cr',   note: '≈13 Wan clips or 40 fast drafts' },
  { id: 'plus',    name: 'Plus',    price: '$39', priceMo: 39, credits: 1000,  creditsFmt: '1,000 cr', note: '≈66 Wan clips · unlocks premium models', hot: true },
  { id: 'ultra',   name: 'Ultra',   price: '$99', priceMo: 99, credits: 3000,  creditsFmt: '3,000 cr', note: 'for daily publishing & 4K hero work' },
];

// Annual Plus: $390/yr (2 months free)
export const ANNUAL_PLUS = { price: '$390/yr', savings: '2 months free' };

export const PRESET_CATEGORIES = ['ALL', 'CINEMATIC', 'UGC', 'VFX', 'ADS'];

export const PRESETS = [
  { id: 'crowd-surf', name: 'CROWD SURF',   model: 'Seedance 2.0 Fast', credits: 5,  category: 'UGC',        bg: 'linear-gradient(135deg,#0e2b3c 0%,#0a5a70 55%,#2ec8b3 100%)', views: '12.4k', cached: true, badge: 'CACHED' },
  { id: 'cctv-night', name: 'CCTV NIGHT',   model: 'Wan 2.5',           credits: 15, category: 'CINEMATIC',  bg: 'linear-gradient(180deg,#08120b 0%,#0e3a1e 60%,#2ea258 100%)', views: '8.7k',  cached: true, badge: 'CACHED' },
  { id: 'sunset-drift',name: 'SUNSET DRIFT', model: 'Hailuo 02',         credits: 20, category: 'CINEMATIC',  bg: 'linear-gradient(135deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)', views: '9.1k',  cached: false },
  { id: 'neon-alley', name: 'NEON ALLEY',   model: 'Kling 2.6 Pro',     credits: 23, category: 'VFX',        bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)', views: '5.8k',  cached: true, badge: 'CACHED' },
  { id: 'warm-portrait',name: 'WARM PORTRAIT',model: 'Nano Banana',      credits: 5,  category: 'UGC',        bg: 'linear-gradient(160deg,#2c1a12 0%,#7a3520 60%,#c9713f 100%)', views: '2.9k' },
  { id: 'sports-cut', name: 'SPORTS CUT',   model: 'Seedance 2.0 Fast', credits: 5,  category: 'ADS',        bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 60%,#3ec1e8 100%)', views: '6.2k',  cached: true, badge: 'CACHED' },
];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5', '21:9'];
export const DURATIONS = ['5s', '10s'];
export const RESOLUTIONS = ['1K', '2K', '4K'];
