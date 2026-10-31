// On 2026-10-31 upload was 60,490 KiB / 12,290 KiB gzip against a 65,536 KiB limit.
// Cold requests spent 1.1–1.3 s before fetch; the separate wrapper added 6.9 MB.
// Cap uploads at 56,000 KiB and keep templates and non-English catalogs out of the wrapper.
// lib/i18n/messages/email/ is permitted: worker.js -> lib/social/reportSchedule.js -> lib/i18n/email.mjs renders scheduled-report emails in the cron.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const WORKER_SIZE_BUDGET_KIB = 56000;
const execFileAsync = promisify(execFile);
const print = (line) => process.stdout.write(`${line}\n`);

export function parseUploadKiB(output) {
  const values = [...output.matchAll(/Total Upload:\s*([\d,]+(?:\.\d+)?)\s*KiB/gi)]
    .map((match) => Number(match[1].replaceAll(',', '')));
  if (!values.length || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Wrangler output did not contain a valid Total Upload in KiB');
  }
  return Math.max(...values);
}

async function writtenBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await writtenBytes(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

async function dryRun(outdir) {
  try {
    const { stdout, stderr } = await execFileAsync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', outdir], {
      cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024,
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    throw new Error(`Wrangler dry-run failed: ${error.stderr || error.stdout || error.message}`);
  }
}

export async function checkWorkerSize({ run = dryRun, measure = writtenBytes, report = print } = {}) {
  const outdir = await mkdtemp(join(tmpdir(), 'veyrnox-worker-size-'));
  try {
    const output = await run(outdir);
    const uploadKiB = parseUploadKiB(output);
    const diskKiB = (await measure(outdir)) / 1024;
    if (!Number.isFinite(diskKiB) || diskKiB <= 0) throw new Error('Wrangler wrote no measurable Worker output');
    const sizeKiB = Math.max(uploadKiB, diskKiB);
    report(`Worker: ${sizeKiB.toFixed(2)} KiB (Total Upload: ${uploadKiB} KiB; files: ${diskKiB.toFixed(2)} KiB; budget: ${WORKER_SIZE_BUDGET_KIB} KiB)`);
    if (sizeKiB > WORKER_SIZE_BUDGET_KIB) throw new Error(`Worker exceeds ${WORKER_SIZE_BUDGET_KIB} KiB budget`);
    return sizeKiB;
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

export function forbiddenWrapperInput(path) {
  const normalized = path.replaceAll('\\', '/');
  if (/(?:^|\/)app\/veyrnox\/_lib\/(?:templates|[^/]*Records|sourceTemplate[^/]*)\.js$/.test(normalized)) return true;
  const messages = /(?:^|\/)lib\/i18n\/messages\/(.*)$/.exec(normalized);
  return Boolean(messages && messages[1] !== 'en.mjs' && !messages[1].startsWith('presets/en/')
    && !messages[1].startsWith('email/'));
}

async function bundleWrapper(options) {
  let esbuild;
  try { esbuild = await import('esbuild'); }
  catch { throw new Error('Worker wrapper check requires the existing esbuild dependency from wrangler / @opennextjs/cloudflare'); }
  return esbuild.build(options);
}

export async function checkWrapper({ bundle = bundleWrapper, report = print } = {}) {
  const result = await bundle({
    absWorkingDir: process.cwd(), entryPoints: ['worker-entry.js'], bundle: true,
    external: ['./.open-next/worker.js', 'node:*', ...builtinModules, 'cloudflare:*'],
    format: 'esm', conditions: ['workerd', 'worker', 'browser'],
    metafile: true, write: false, logLevel: 'silent',
  });
  const inputs = Object.entries(result.metafile.inputs).sort((a, b) => b[1].bytes - a[1].bytes);
  report('Wrapper largest inputs (KiB):');
  for (const [path, { bytes }] of inputs.slice(0, 20)) report(`  ${(bytes / 1024).toFixed(2)} ${path}`);
  const sourceBytes = inputs.reduce((total, [, input]) => total + input.bytes, 0);
  const outputBytes = Object.values(result.metafile.outputs).reduce((total, output) => total + output.bytes, 0);
  report(`Wrapper total: ${(sourceBytes / 1024).toFixed(2)} KiB inputs; ${(outputBytes / 1024).toFixed(2)} KiB bundled`);
  const forbidden = inputs.map(([path]) => path).filter(forbiddenWrapperInput);
  if (forbidden.length) throw new Error(`Forbidden wrapper inputs:\n${forbidden.join('\n')}`);
  return result.metafile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.includes('--wrapper')) await checkWrapper();
    else await checkWorkerSize();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
