// Writes src/lib/oddlings/cast.json from the web's Oddlings cast, so the phone shows the same 72 original characters
// without copying 600 lines of data by hand. `--check` fails when the file is out of date (the drift test runs it).
// Plain Node, no dependencies: it imports the web files by relative path.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', '..', '..', 'app', 'veyrnox', '_lib');
const character = await import(join(web, 'character.js'));
const options = await import(join(web, 'characterOptions.js'));
const studio = await import(join(web, 'oddlingStudio.js'));
const explore = await import(join(web, 'oddlingExplore.js'));

const note = (table, label) => (table.find(([name]) => name === label) || [])[1] || '';
const tabs = explore.ODDLING_EXPLORE_TABS.map(({ id, label }) => ({ id, label }));
const inTab = (id, tab) => studio.oddlingsForSource(tab).some((item) => item.id === id);

const characters = character.ODDLING_ARCHETYPES.map((item) => {
  const picks = item.picks || {};
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    hook: item.hook,
    accent: item.accent,
    collections: tabs.filter(({ id }) => id !== 'all' && inTab(item.id, id)).map(({ id }) => id),
    premise: {
      obsession: picks.oddling_obsession || '',
      voice: picks.oddling_voice || '',
      voiceNote: note(character.ODDLING_TONES, picks.oddling_voice),
      show: picks.oddling_show || '',
      showNote: note(character.ODDLING_SHOWS, picks.oddling_show),
    },
    identity: character.oddlingIdentity(picks),
    traits: character.CHARACTER_GROUPS.flatMap((group) => (picks[group.id] ? [`${group.label}: ${options.characterOptionLabel(group.id, picks[group.id])}`] : [])),
    picks,
  };
});

// One character per line keeps the file small and a diff readable.
const out = `{"generatedFrom":"app/veyrnox/_lib/character.js","tabs":${JSON.stringify(tabs)},"characters":[\n${characters.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`;
const file = join(here, '..', 'src', 'lib', 'oddlings', 'cast.json');
let current = '';
try { current = readFileSync(file, 'utf8'); } catch { /* first run */ }
if (process.argv.includes('--check')) {
  if (current !== out) { console.error('src/lib/oddlings/cast.json is out of date. Run node scripts/sync-oddlings-cast.mjs'); process.exit(1); }
  console.log('Up to date.');
} else {
  if (current !== out) writeFileSync(file, out);
  console.log(current === out ? 'Up to date.' : 'Wrote cast.json');
}
