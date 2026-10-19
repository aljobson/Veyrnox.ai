import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appFiles, candidates } from '../scripts/audit-public-i18n.mjs';

test('app coverage inventories all app pages and imported JSX, excluding admin', () => {
  const files = appFiles();
  for (const area of ['create', 'library', 'publish', 'account', 'chat', 'editor', 'video-agent']) assert.ok(files.includes(`app/veyrnox/app/${area}/page.js`), area);
  assert.ok(files.includes('app/veyrnox/_components/chat/ChatWorkspace.js'));
  assert.ok(!files.some(file => file.startsWith('app/veyrnox/app/admin/')));
  for (const area of ['', 'account/', 'create/', 'library/', 'publish/', 'chat/']) assert.ok(files.includes(`app/veyrnox/app/${area}layout.js`), 'metadata-only layouts are included');
});

test('app audit detects static and generated metadata, including local bindings and title objects', () => {
  const file = 'app/veyrnox/app/test/layout.js';
  const sources = [
    `export const metadata = { title: 'Untranslated', description: 'Description', alternates: { canonical: '/app/test' }, robots: { index: false } };`,
    `export async function generateMetadata() { const title = 'Untranslated'; return { title, description: 'Description' }; }`,
    `const title = 'Untranslated'; export const generateMetadata = async () => ({ title: { default: title, template: '%s — Veyrnox.ai' }, description: 'Description' });`,
    `export const generateMetadata = () => { const title = 'Untranslated'; return { title, description: 'Description' }; };`,
    `export function generateMetadata() { return { title: { absolute: 'Untranslated' }, openGraph: { description: 'Description', url: '/app/test' } }; }`,
  ];
  for (const source of sources) {
    const rows = candidates(file, source, { app: true });
    assert.deepEqual(rows.filter(row => row.status === 'unresolved').map(row => row.text).sort(), ['Description', 'Untranslated']);
    assert.ok(rows.every(row => row.kind === 'metadata'));
  }
  const translated = `export async function generateMetadata() { const title = tOr(t, 'app.meta.create.title', 'Create'); return { title, openGraph: { title: \`\${title} — Veyrnox.ai\` } }; }`;
  assert.ok(candidates(file, translated, { app: true }).some(row => row.kind === 'metadata-lookup' && row.status === 'translated'));
  assert.ok(!candidates(file, translated, { app: true }).some(row => row.status === 'unresolved'));
  for (const source of [translated.replaceAll('app.meta.create.title', 'app.meta.missing.title'), translated.replace("'Create'", "'Wrong fallback'"), `export const metadata = { title: 'إنشاء' };`]) {
    assert.ok(candidates(file, source, { app: true }).some(row => row.status === 'unresolved'));
  }
  assert.deepEqual(candidates('app/veyrnox/app/admin/layout.js', sources[0], { app: true }), []);
});

test('app UI has no unresolved visible literals', () => {
  const unresolved = appFiles().flatMap(file => candidates(file, readFileSync(file, 'utf8'), { app: true })).filter(row => row.status === 'unresolved');
  const areas = Object.entries(Object.groupBy(unresolved, row => row.file.startsWith('app/veyrnox/app/') ? row.file.split('/')[3] : 'shared')).map(([area, rows]) => `${area}: ${rows.length}`).sort().join(', ');
  assert.equal(unresolved.length, 0, `${unresolved.length} unresolved literals. By area: ${areas}. Run node scripts/audit-public-i18n.mjs --app for the complete inventory.\n${unresolved.slice(0,20).map(row => `${row.file}:${row.line} ${row.kind}: ${row.text}`).join('\n')}`);
});

test('app audit detects JSX, visible props and event-driven toast copy', () => {
  const source = `<><p>Untranslated heading</p><input title="Untranslated title" aria-label="Untranslated label" placeholder="Untranslated placeholder"/><button onClick={() => toast.success('Saved'); new CustomEvent('veyrnox:auth-required'); setConfirm('global')}>Press me</button></>`;
  const rows = candidates('app/veyrnox/app/test/page.js', source, { app: true });
  assert.ok(!rows.some(row => ['veyrnox:auth-required', 'global'].includes(row.text)), 'event names and scope enums are not visible copy');
  for (const expected of ['Untranslated heading', 'Untranslated title', 'Untranslated label', 'Untranslated placeholder', 'Saved']) assert.ok(rows.some(row => row.text === expected && row.status === 'unresolved'), expected);
});
