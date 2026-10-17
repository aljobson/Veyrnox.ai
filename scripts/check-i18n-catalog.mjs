// node scripts/check-i18n-catalog.mjs es [fr ...]
// Prints drift between lib/i18n/messages/en.mjs and the named catalogs.
import { checkCatalog } from '../lib/i18n/check.mjs';
import en from '../lib/i18n/messages/en.mjs';

const codes = process.argv.slice(2);
if (codes.length === 0) {
  console.error('usage: node scripts/check-i18n-catalog.mjs <code> [<code> ...]');
  process.exit(2);
}
let bad = 0;
for (const code of codes) {
  const { default: catalog } = await import(`../lib/i18n/messages/${code}.mjs`);
  const problems = checkCatalog(en, catalog, code);
  for (const p of problems) console.error(p);
  console.log(`${code}: ${problems.length === 0 ? 'ok' : `${problems.length} problem(s)`} (${Object.keys(catalog).length} keys)`);
  bad += problems.length;
}
process.exit(bad === 0 ? 0 : 1);
