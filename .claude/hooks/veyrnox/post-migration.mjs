#!/usr/bin/env node
// PostToolUse runner: lints a migration after it is written and hands the
// findings back to Claude (exit 2). Advisory: the file is already on disk.
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintMigration } from './rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let filePath;
try {
  filePath = JSON.parse(readFileSync(0, 'utf8')).tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!filePath) process.exit(0);

const rel = relative(ROOT, resolve(filePath));
if (!rel.startsWith('packages/db/schema/supabase/') || !rel.endsWith('.sql')) process.exit(0);

let findings;
try {
  findings = lintMigration(readFileSync(resolve(ROOT, rel), 'utf8'));
} catch {
  process.exit(0);
}
if (findings.length === 0) process.exit(0);

process.stderr.write(
  `[veyrnox migration lint] ${rel}\n- ${findings.join('\n- ')}\n` +
    'Fix these, or say why each does not apply (for example an unchanged signature keeps its ACL).\n'
);
process.exit(2);
