import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import en from '../lib/i18n/messages/app/en/film-workspace.mjs';
import { checkCatalog } from '../lib/i18n/check.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const workspace = read('app/veyrnox/_components/film/FilmWorkspace.js');
const panel = read('app/veyrnox/_components/film/FilmCloud.js');
const pure = read('app/veyrnox/_lib/filmStudioCloud.js');
test('flag-off and signed-out render paths cannot mount the requesting panel', () => {
  assert.match(workspace, /FilmWorkspace\(\{cloud=false\}\)/);
  assert.match(workspace, /\{cloud&&userId&&<FilmCloud key=\{userId\}/);
  assert.doesNotMatch(workspace, /gatewayFetch/);
  const page=read('app/veyrnox/app/film-studio/page.js');
  assert.match(page, /export const dynamic = 'force-dynamic'/);
  assert.match(page, /process.env.TENANT_PROJECTS_ENABLED === 'true' && process.env.FILM_STUDIO_CLOUD_ENABLED === 'true'/);
  assert.match(page, /<FilmWorkspace cloud=\{cloud\}/);
  assert.match(panel, /if \(!userId \|\| list\?\.userId !== userId\) return null/);
});
test('all visible cloud text comes from the catalog; server errors are never rendered', () => {
  assert.doesNotMatch(panel, /\{(?:err|error)\.(?:message|code|status)|t\((?:err|error)\./);
  assert.doesNotMatch(panel, /(?:err|error)\.message/);
  assert.match(panel, /cloudErrorKey\(err\)/);
  for (const key of (panel+pure).matchAll(/['"](app\.film\.cloud\.[A-Za-z]+)['"]/g)) assert.equal(typeof en[key[1]], 'string', key[1]);
  assert.doesNotMatch(Object.values(en).join('\n'), /still saved in this browser/);
});
test('all cloud controls are real, labelled, busy-disabled 44px buttons; dialogs reuse focus trap', () => {
  assert.match(panel, /<section aria-labelledby="film-cloud-heading"/); assert.match(panel, /<h2 id="film-cloud-heading"/); assert.match(panel, /<ul/);
  for (const match of panel.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)) {
    assert.match(match[1], /type="button"/); assert.match(match[1], /className=\{button\}/);
    assert.match(match[1], /disabled=\{busy\}/); assert.match(match[1], /aria-busy=\{busy\}/); assert.match(match[2], /t\('app\.film\.cloud\./);
  }
  assert.match(panel,/const button = 'min-h-11/); assert.match(panel,/aria-label=\{t\('app.film.cloud.openName'/); assert.match(panel,/aria-label=\{t\('app.film.cloud.removeName'/);
  assert.match(panel, /<ConfirmDialog/); assert.match(panel, /tone=\{dialog.kind === 'remove' \? 'danger'/);
  assert.match(panel, /role="status"/); assert.match(panel, /'alert' : 'status'/);
});
test('replacement keys reset editors and pending import; pending starter belongs to the store', () => {
  assert.match(workspace, /const \{film,stage,ready,userId,error,saved,generation\}=state/);
  assert.match(workspace, /<FilmFiles key=\{generation\}/); assert.match(workspace, /<section key=\{generation\}/);
  assert.match(workspace, /onImport=\{next=>replaceFilm\(next,null\)\}/);
  assert.doesNotMatch(workspace, /setPendingStarter/); assert.match(workspace, /pendingVisible\(state\)/);
  const store=read('app/veyrnox/_lib/filmStudioStore.js');
  assert.match(store,/if \(typeof window !== 'undefined'\) onSessionChange/); assert.match(store,/boundaryPatch\(state, getStoredUserId\(\)\)/);
});
test('11 catalogs preserve every cloud key and interpolation slot', async () => {
  for (const locale of ['ar','de','es','fr','hi','ja','ko','pt','ru','zh']) {
    const { default: messages }=await import(`../lib/i18n/messages/app/${locale}/film-workspace.mjs`);
    assert.deepEqual(checkCatalog(en,messages,locale),[]);
  }
});
