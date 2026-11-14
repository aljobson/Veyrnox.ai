// The edge middleware needs publication identities, never prompt records.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { IMAGE_TEMPLATES, isImageTemplate } from '../app/veyrnox/_lib/imageTemplates.js';
export function publicTemplateIdsBytes() {
  return JSON.stringify({ video: [...new Set(ALL_TEMPLATES.map(t => t.id))].sort(), image: IMAGE_TEMPLATES.filter(isImageTemplate).map(t => t.id).sort() }) + '\n';
}
const path = new URL('../lib/publicTemplateIds.json', import.meta.url);
if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8'), publicTemplateIdsBytes(), 'Run node scripts/generate-public-template-ids.mjs');
else writeFileSync(path, publicTemplateIdsBytes());
