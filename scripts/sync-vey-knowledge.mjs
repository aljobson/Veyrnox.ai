import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVeyKnowledgeArtifact, renderVeyKnowledgeModule } from './lib/vey-knowledge-source.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');
const outputFile = path.join(root, 'lib/generatedProductInventory.js');
const artifact = await buildVeyKnowledgeArtifact(root);
const output = renderVeyKnowledgeModule(artifact);
const checkOnly = process.argv.includes('--check');

let current = '';
try {
  current = await readFile(outputFile, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

if (checkOnly) {
  if (current !== output) {
    console.error('Vey knowledge is stale. Run: npm run sync:vey-knowledge');
    process.exitCode = 1;
  } else {
    console.log(`Vey knowledge is current (${artifact.routes.length} routes, ${artifact.documents.length} document sections).`);
  }
} else if (current !== output) {
  await writeFile(outputFile, output, 'utf8');
  console.log(`Updated Vey knowledge (${artifact.routes.length} routes, ${artifact.documents.length} document sections).`);
} else {
  console.log(`Vey knowledge already current (${artifact.routes.length} routes, ${artifact.documents.length} document sections).`);
}
