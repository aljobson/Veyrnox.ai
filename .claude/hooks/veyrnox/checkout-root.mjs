import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

// Preserve missing suffixes while resolving symlinks in the existing prefix.
export function canonicalPath(file) {
  const raw = resolve(file);
  let ancestor = raw;
  for (;;) {
    try { return resolve(realpathSync(ancestor), relative(ancestor, raw)); } catch { /* Try its parent. */ }
    const parent = dirname(ancestor);
    if (parent === ancestor) return raw;
    ancestor = parent;
  }
}

export function checkoutRoot(file, fallback) {
  let directory = dirname(file);
  for (;;) {
    try { if (statSync(directory).isDirectory()) break; } catch { /* New directory: walk up. */ }
    const parent = dirname(directory);
    if (parent === directory) return canonicalPath(fallback);
    directory = parent;
  }
  try {
    const root = execFileSync('git', ['-C', canonicalPath(directory), 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return canonicalPath(root || fallback);
  } catch { return canonicalPath(fallback); }
}
