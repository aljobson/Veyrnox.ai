// Pure engine only: Metro never traverses the web app's React/node_modules.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const source = new URL('../../../packages/live-edit/', import.meta.url);
const target = new URL('../src/lib/liveEdit/shared/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const name of ['effects', 'makeup', 'hair', 'regions', 'looks', 'smoothing']) {
    const body = readFileSync(new URL(`${name}.js`, source), 'utf8');
    const path = new URL(`${name}.js`, target);
    if (process.argv.includes('--check')) {
        if (readFileSync(path, 'utf8') !== body) throw Error(`Live Edit parity: ${name}`);
    } else writeFileSync(path, body);
}
console.log(`Live Edit shared engine ${process.argv.includes('--check') ? 'verified' : 'synced'}: ${fileURLToPath(target)}`);
