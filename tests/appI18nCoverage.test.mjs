import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appFiles, candidates } from '../scripts/audit-public-i18n.mjs';

test('app coverage inventories all app pages and imported JSX, excluding admin', () => {
  const files = appFiles();
  for (const area of ['create', 'library', 'publish', 'account', 'chat', 'editor', 'video-agent']) assert.ok(files.includes(`app/veyrnox/app/${area}/page.js`), area);
  assert.ok(files.includes('app/veyrnox/_components/chat/ChatWorkspace.js'));
  assert.ok(!files.some(file => file.startsWith('app/veyrnox/app/admin/')));
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
