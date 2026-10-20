// Prints the web's "animate this portrait" prompt for every cast character and every opening move, as JSON, so a test
// can require the phone's words to match. Plain Node: it imports the web files by relative path.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app', 'veyrnox', '_lib');
const character = await import(join(web, 'character.js'));
const studio = await import(join(web, 'oddlingStudio.js'));
const out = {};
for (const { id } of character.ODDLING_ARCHETYPES) {
  for (const motion of [...studio.ODDLING_MOTIONS.map((m) => m.id), '', 'unknown-move']) {
    out[`${id}|${motion}`] = studio.buildOddlingAnimationPrompt(id, motion);
  }
}
process.stdout.write(JSON.stringify(out));
