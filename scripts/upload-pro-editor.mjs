#!/usr/bin/env node
// Uploads a built Pro editor site (scripts/build-pro-editor.mjs) to its R2 bucket.
//
//   node scripts/upload-pro-editor.mjs --dist .pro-editor-dist --bucket veyrnox-pro-editor-site          (dry run)
//   node scripts/upload-pro-editor.mjs --dist .pro-editor-dist --bucket veyrnox-pro-editor-site --apply  (uploads)
//
// Every file is checked against manifest.json first; manifest.json goes up LAST, because the
// serving Worker publishes exactly what the manifest lists.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const SAFE_KEY = /^[A-Za-z0-9._\-/]+$/;

export function planUpload(dist) {
  const manifestPath = join(dist, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('manifest.json not found: build first');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const items = [];
  for (const [key, sha] of Object.entries(manifest.files)) {
    if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) throw new Error('unsafe key in manifest: ' + key);
    const file = join(dist, key);
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== sha) throw new Error('changed since the build: ' + key);
    items.push({ key, file, type: TYPES[extname(key)] || 'application/octet-stream' });
  }
  // The publish step: last.
  items.push({ key: 'manifest.json', file: manifestPath, type: TYPES['.json'] });
  return items;
}

export function putArgs(bucket, item) {
  return ['wrangler', 'r2', 'object', 'put', bucket + '/' + item.key, '--file', item.file, '--content-type', item.type, '--remote'];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i += 1; }
  }
  if (!args.dist || !args.bucket || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(args.bucket)) throw new Error('usage: --dist DIR --bucket NAME [--apply]');
  const items = planUpload(resolve(args.dist));
  for (const item of items) {
    const cmd = ['npx', ...putArgs(args.bucket, item)];
    if (!args.apply) { console.log('[dry run] ' + cmd.join(' ')); continue; }
    console.log('uploading ' + item.key);
    execFileSync('npx', putArgs(args.bucket, item), { stdio: 'inherit' });
  }
  console.log(args.apply ? 'uploaded ' + items.length + ' files' : 'dry run: ' + items.length + ' files, nothing uploaded (add --apply)');
}
