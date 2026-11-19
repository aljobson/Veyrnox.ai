#!/usr/bin/env node
// Builds the Pro editor child-origin site from the pinned FilmCraft web release (plan rev 8).
//
//   node scripts/build-pro-editor.mjs --zip PATH/filmcraft-web-0.20.1.zip --out DIR \
//        --parents https://veyrnox.ai[,https://staging.example]
//
// Output (all static, nothing deployed): host.html, pro/*.mjs, fc/* (upstream files, index.html
// post-processed), _headers, manifest.json. The 50 MB wasm is NOT committed; DIR must be outside
// git (default .pro-editor-dist is ignored).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllowedParents } from '../pro-editor/src/protocol.mjs';
import { buildHeadersFile } from '../pro-editor/src/headers.mjs';
import { transformIndexHtml } from '../pro-editor/src/transform.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'pro-editor', 'src');
// Browser modules copied next to the host page (host.html itself is a template).
const BROWSER_MODULES = [
  'protocol.mjs', 'session.mjs', 'hostCore.mjs', 'host-main.mjs', 'gateLogic.mjs', 'purgeCore.mjs', 'purge-main.mjs',
];

export const MARKER = '.pro-editor-build';

/**
 * The output directory is replaced on every build, so it must never be a directory the user
 * cares about. Refuses: the repo root or any ancestor of it, the zip's folder, the cwd, the home
 * directory, the filesystem root, a non-directory, a directory inside the repo that is not an
 * ignored `.pro-editor*` folder, and any non-empty directory that was not made by this script.
 */
export function assertSafeOut(out, { root = ROOT, zip, cwd = process.cwd() } = {}) {
  const target = resolve(out);
  const guarded = [root, cwd, homedir(), sep, zip ? dirname(resolve(zip)) : null].filter(Boolean).map((p) => resolve(p));
  for (const path of guarded) {
    if (target === path || path.startsWith(target + sep)) throw new Error('unsafe --out: it is, or contains, ' + path);
  }
  // Inside the repo only a root-level .pro-editor-dist* folder is allowed: that is exactly what
  // .gitignore excludes, so the 50 MB wasm can never be staged by accident.
  if (target.startsWith(resolve(root) + sep)
      && !(dirname(target) === resolve(root) && basename(target).startsWith('.pro-editor-dist'))) {
    throw new Error('unsafe --out: inside the repository it must be a root-level .pro-editor-dist* folder (the ignored one)');
  }
  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) throw new Error('unsafe --out: not a directory');
    const entries = readdirSync(target);
    if (entries.length > 0 && !entries.includes(MARKER)) throw new Error('unsafe --out: not empty and not a previous Pro editor build');
  }
  return target;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseArgs(argv) {
  const args = { out: join(ROOT, '.pro-editor-dist') };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || value === undefined) throw new Error('usage: --zip FILE --out DIR --parents ORIGINS');
    args[key.slice(2)] = value;
  }
  return args;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out.sort();
}

export function buildProEditor({ zip, out: requestedOut, parents }) {
  const finalOut = assertSafeOut(requestedOut, { zip });
  const pins = JSON.parse(readFileSync(join(ROOT, 'pro-editor', 'pins.json'), 'utf8'));
  const allowed = parseAllowedParents(parents);
  if (allowed.length === 0) throw new Error('--parents must list exact origins (https://… or http://localhost…)');

  if (!existsSync(zip)) throw new Error('zip not found: ' + zip);
  const zipSha = sha256File(zip);
  if (zipSha !== pins.zip.sha256) throw new Error('zip sha256 mismatch: ' + zipSha);

  const tmp = mkdtempSync(join(tmpdir(), 'pro-editor-'));
  // Built next to the final folder and swapped in only when complete, so a failed build never
  // leaves a half-written site and never deletes anything before the new one exists.
  mkdirSync(dirname(finalOut), { recursive: true });
  const out = mkdtempSync(join(dirname(finalOut), basename(finalOut) + '.build-'));
  try {
    // Untrusted archive: extracted into its own empty directory, never executed.
    execFileSync('unzip', ['-q', zip, '-d', tmp]);
    const roots = readdirSync(tmp);
    if (roots.length !== 1) throw new Error('unexpected zip layout');
    const upstream = join(tmp, roots[0]);

    for (const [name, expected] of Object.entries(pins.files)) {
      const actual = sha256File(join(upstream, name));
      if (actual !== expected) throw new Error(name + ' sha256 mismatch: ' + actual);
    }

    mkdirSync(join(out, 'pro'), { recursive: true });
    cpSync(upstream, join(out, 'fc'), { recursive: true });
    // Upstream sample server rules would be inert here and confusing: our _headers is the one.
    rmSync(join(out, 'fc', '_headers'), { force: true });
    rmSync(join(out, 'fc', '.htaccess'), { force: true });

    const transformed = transformIndexHtml(readFileSync(join(upstream, 'index.html'), 'utf8'));
    writeFileSync(join(out, 'fc', 'index.html'), transformed.html);
    for (const [name, text] of Object.entries(transformed.files)) writeFileSync(join(out, 'pro', name), text);

    for (const name of BROWSER_MODULES) cpSync(join(SRC, name), join(out, 'pro', name));
    const host = readFileSync(join(SRC, 'host.html'), 'utf8').replace('__ALLOWED_PARENTS__', allowed.join(','));
    writeFileSync(join(out, 'host.html'), host);
    writeFileSync(join(out, 'purge.html'), readFileSync(join(SRC, 'purge.html'), 'utf8').replace('__ALLOWED_PARENTS__', allowed.join(',')));
    writeFileSync(join(out, '_headers'), buildHeadersFile({ parents: allowed, styleHashes: transformed.styleHashes }));

    const files = {};
    for (const file of listFiles(out)) files[file] = sha256File(join(out, file));
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({
      release: pins.release, zipSha256: zipSha, parents: allowed, signature: pins.signature, files,
    }, null, 2) + '\n');
    writeFileSync(join(out, MARKER), 'built by scripts/build-pro-editor.mjs; safe to replace\n');
    const old = existsSync(finalOut) ? finalOut + '.old-' + process.pid : null;
    if (old) renameSync(finalOut, old);
    renameSync(out, finalOut);
    if (old) rmSync(old, { recursive: true, force: true });
    return { out: finalOut, files: Object.keys(files).length, parents: allowed };
  } catch (error) {
    rmSync(out, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.zip || !args.parents) throw new Error('usage: --zip FILE --out DIR --parents ORIGINS');
  const result = buildProEditor({ zip: resolve(args.zip), out: resolve(args.out), parents: args.parents });
  console.log('built ' + result.files + ' files into ' + result.out + ' for ' + result.parents.join(', '));
}
