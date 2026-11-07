import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEMPLATE_CHUNK_BUDGET = 1_000_000;
export function checkTemplateChunks(directory = '.next/static/chunks') {
  const failures = [], checked = [];
  const templateIds = Object.keys(JSON.parse(readFileSync(new URL('../lib/templateRoutes.json', import.meta.url), 'utf8')).templates);

  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!/\.(?:js|mjs)$/.test(path)) continue;
      const content = readFileSync(path, 'utf8');
      const size = statSync(path).size;
      checked.push({ path, size });
      if (content.includes('sourcePromptIndex')) failures.push(`${path}: full fidelity contract marker`);
      // An oversized unrelated editor/vendor chunk is outside this guard's scope.
      // Both prompt-table keys and a dense run of actual template IDs identify data.
      const templateData = /boundHash|photoPromptHash|tokenMap|sourcePrompt|boundModelId/.test(content)
        || templateIds.filter(id => content.includes(JSON.stringify(id))).length >= 20;
      if (size > TEMPLATE_CHUNK_BUDGET && templateData) failures.push(`${path}: ${size} bytes with template data (budget ${TEMPLATE_CHUNK_BUDGET})`);
    }
  }
  visit(directory); // Missing build output fails, rather than reporting a false pass.
  return { checked, failures };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = checkTemplateChunks(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
