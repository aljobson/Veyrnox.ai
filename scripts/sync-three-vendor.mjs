#!/usr/bin/env node
// Copies the pinned three.js ES modules into public/ so the photo studio loads them as same-origin
// static files (CSP script-src 'self'). They are never bundled: that keeps three.js out of the Worker.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version;
const out = join(root, 'public/photo-studio/vendor', `three-${version}`);
mkdirSync(out, { recursive: true });
const files = ['three.module.js', 'three.core.js'];
const manifest = { package: 'three', version, licence: 'MIT', source: 'npm three build/', files: {} };
for (const name of files) {
    copyFileSync(join(root, 'node_modules/three/build', name), join(out, name));
    manifest.files[name] = createHash('sha256').update(readFileSync(join(out, name))).digest('hex');
}
copyFileSync(join(root, 'node_modules/three/LICENSE'), join(out, 'LICENSE'));
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`three ${version}: ${files.length} files -> ${out}`);
