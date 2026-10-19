// Runs the web's Oddling builder over a fixed set of cases and prints the results as JSON. The drift test runs
// the app's port (src/lib/oddlingsBuilder.ts) over the same cases and compares. Seeded, so the output is stable.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app', 'veyrnox', '_lib');
const character = await import(join(web, 'character.js'));
const options = await import(join(web, 'characterOptions.js'));
const studio = await import(join(web, 'oddlingStudio.js'));

export const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const groups = character.CHARACTER_GROUPS;
const cases = character.ODDLING_ARCHETYPES.map((item, i) => {
  let edited = { ...item.picks };
  for (let k = 0; k < 6; k += 1) {
    const g = groups[(i * 7 + k * 13) % groups.length];
    edited = options.changeCharacterPick(edited, g.id, g.options[(i + k) % g.options.length][0]);
  }
  const motion = studio.ODDLING_MOTIONS[i % studio.ODDLING_MOTIONS.length].id;
  const scene = studio.ODDLING_SCENES[i % studio.ODDLING_SCENES.length];
  return {
    id: item.id,
    sanitized: character.sanitizeOddlingPicks(item.picks),
    portrait: studio.buildOddlingStudioPrompt({ picks: item.picks }),
    motion: studio.buildOddlingStudioPrompt({ picks: item.picks, mode: 'motion', motionId: motion, scene }),
    edited,
    editedPrompt: studio.buildOddlingStudioPrompt({ picks: edited }),
    style: [1, 2, 3].map((s) => studio.randomizeOddlingStyle(item.picks, seeded(i * 10 + s))),
    all: [1, 2, 3].map((s) => studio.randomizeOddlingAll(item.picks, seeded(i * 10 + s))),
  };
});

const messy = [null, 'x', [], {}, { character_type: 'Nope', oddling_name: '  Ada\n\tLovelace  ', oddling_obsession: 'x'.repeat(300), oddling_voice: 'Dry oracle', oddling_show: 'Bad' },
  { brows: 'Thick', face_features: 'Tiny Brows', everyday_accessories: 'Glasses', accessories: 'Tiny Monocle' }];
console.log(JSON.stringify({ cases, messy: messy.map((m) => character.sanitizeOddlingPicks(m)), empty: studio.buildOddlingStudioPrompt({ picks: {} }) }));
