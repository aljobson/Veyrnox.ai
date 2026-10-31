// On 2026-10-31 the Worker was 60,490 KiB (12,290 KiB gzip), near the 65,536 KiB limit.
// App catalogs contributed about 7 MB; cold requests spent 1.1–1.3 s before fetch.
// Emit unchanged catalogs as static JSON so those bytes need not be parsed at isolate start.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildAppMessages({ root = process.cwd(), check = false } = {}) {
  const source = join(root, 'lib/i18n/messages/app');
  const destination = join(root, 'public/_i18n/app');
  const files = (await readdir(source)).filter((name) => name.endsWith('.mjs')).sort();
  if (!files.length) throw new Error(`No app catalogs found in ${source}`);
  if (!check) await mkdir(destination, { recursive: true });
  const stale = [];
  for (const file of files) {
    const catalog = (await import(pathToFileURL(join(source, file)).href)).default;
    const expected = `${JSON.stringify(catalog)}\n`;
    const target = join(destination, file.replace(/\.mjs$/, '.json'));
    if (check) {
      let actual;
      try { actual = await readFile(target, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (actual !== expected) stale.push(target);
    } else {
      await writeFile(target, expected);
    }
  }
  if (stale.length) throw new Error(`Missing or stale app catalogs:\n${stale.join('\n')}`);
  return files.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const check = process.argv.includes('--check');
    const count = await buildAppMessages({ check });
    process.stdout.write(`${check ? 'Checked' : 'Built'} ${count} app catalogs.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
