#!/usr/bin/env node
// Historical README entries stay verbatim. Filename identity includes amendments and repeated numbers.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const defaultDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/adr');
export const cutoff = 'The historical index below is frozen at the exact filenames in `index-baseline.txt`; create new ADR files without editing this README or baseline, and read the full index with `node scripts/adr-index.mjs` from the repository root.\n\n';
export const numberedFiles = directory => readdirSync(directory).filter(name => /^\d{4,}-.+\.md$/.test(name)).sort();
export function readAdr(directory, filename) {
    const text = readFileSync(join(directory, filename), 'utf8');
    const heading = text.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
    // Accept Status:, **Status:**, **Status**: and optional list markers.
    const status = text.match(/^\s*(?:[-*]\s+)?(?:\*\*)?Status(?:\*\*)?\s*:(?:\*\*)?\s*(.+)$/mi)?.[1]?.trim();
    return { filename, number: filename.match(/^\d+/)[0], title: heading, status };
}
export function readIndex(directory = defaultDirectory) {
    const readme = readFileSync(join(directory, 'README.md'), 'utf8');
    const baseline = readFileSync(join(directory, 'index-baseline.txt'), 'utf8').trim().split('\n');
    const entries = numberedFiles(directory).map(filename => readAdr(directory, filename));
    const linked = new Set([...readme.matchAll(/\]\((?:\.\/)?(\d{4,}-[^)]+\.md)(?:#[^)]*)?\)/g)].map(match => match[1]));
    return { readme, baseline, entries, linked };
}
export function validateIndex(directory = defaultDirectory) {
    const { baseline, entries } = readIndex(directory);
    const newEntries = entries.filter(entry => !baseline.includes(entry.filename));
    const errors = newEntries.flatMap(entry => [
        ...(!entry.title ? [`${entry.filename}: missing first heading (# Title)`] : []),
        ...(!entry.status ? [`${entry.filename}: missing Status line`] : []),
    ]);
    const byNumber = new Map();
    for (const entry of newEntries) {
        const filenames = byNumber.get(entry.number) ?? [];
        filenames.push(entry.filename);
        byNumber.set(entry.number, filenames);
    }
    for (const [number, filenames] of byNumber) {
        if (filenames.length > 1) console.warn(`WARNING: New ADRs share numeric prefix ${number}: ${filenames.join(', ')}. Filename identity keeps them distinct; validation still passes if both are well formed.`);
    }
    return errors;
}
export function renderIndex(directory = defaultDirectory) {
    const { readme, entries, linked } = readIndex(directory);
    const cell = value => String(value).replace(/\|/g, '\\|');
    const missing = entries.filter(entry => !linked.has(entry.filename));
    return readme + '\n\n## ADR files without a historical README entry\n\n' +
        '| Filename | Number | First heading | Status line |\n|---|---|---|---|\n' +
        missing.map(entry => `| [${entry.filename}](${entry.filename}) | ${entry.number} | ${cell(entry.title ?? '(no heading; historical file)')} | ${cell(entry.status ?? '(no status line; historical file)')} |`).join('\n') + '\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const errors = validateIndex();
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log(renderIndex());
}
