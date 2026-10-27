// ADR-0270: review every expanded string, a conservative superset of fixed-width labels.
// No translation is shortened by this script. Run with --write after editing a catalog.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnglishCatalog } from './sync-web-i18n.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'i18n');
const en = readEnglishCatalog();
// Added CLDR categories use the English family's other form (ADR-0270).
const sourceFor = key => en[key] ?? en[key.replace(/\.(zero|one|two|few|many|other)$/, '.other')];
for (const file of readdirSync(join(root, 'messages', 'app')).filter(f => f.endsWith('.ts'))) {
    const locale = file.slice(0, -3);
    // App catalogs are data-only JSON objects with a TypeScript assertion.
    const source = readFileSync(join(root, 'messages', 'app', file), 'utf8');
    const app = JSON.parse(source.split('export default ')[1].replace(/ as const;\s*$/, ''));
    const webSource = readFileSync(join(root, 'messages', `${locale}.ts`), 'utf8');
    const web = new Function(webSource.replace(/ as const;/, ';').replace(/export default (\w+);/, 'return $1;'))();
    const catalog = { ...app, ...web };
    const rows = Object.entries(catalog).filter(([key, value]) => sourceFor(key) && [...value].length > [...sourceFor(key)].length * 1.6)
        .map(([key, value]) => ({ id: key, english: sourceFor(key), translation: value, ratio: Number(([...value].length / [...sourceFor(key)].length).toFixed(2)) }));
    const body = JSON.stringify(rows, null, 2) + '\n';
    const report = join(root, 'review', `${locale}-length.json`);
    if (process.argv.includes('--write')) writeFileSync(report, body);
    else if (readFileSync(report, 'utf8') !== body) throw Error(`Stale length review: ${locale}. Run node scripts/check-app-i18n.mjs --write`);
    console.log(`${locale}: ${rows.length} strings exceed 1.6x English; review ${report}`);
}
