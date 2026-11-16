import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
// Execute the actual server page functions with JSX reduced to inert objects.
async function page(file, enabled) {
  const source = ts.transpile(await readFile(file, 'utf8'), { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS });
  const sandbox = { exports: {}, React: { createElement: () => ({ rendered: true }) }, require: () => ({
    musicBeatEditorEnabled: () => enabled, redirect: path => { throw new Error(`redirect:${path}`); }, getT: () => ({ t: s => s }),
  }) };
  vm.runInNewContext(source, sandbox); return sandbox.exports.default;
}
test('both Studio pages redirect only when the beat editor flag is on', async () => {
  for (const [file, target] of [['studio/page.js', '/app/music/beats'], ['studio/[id]/page.js', '/app/music/beats/new?song=owned-song']]) {
    const active = await page(`app/veyrnox/app/music/${file}`, true);
    await assert.rejects(async () => active({ params: Promise.resolve({ id: 'owned-song' }) }), new RegExp(`redirect:${target.replace('?', '\\?')}`));
    const inactive = await page(`app/veyrnox/app/music/${file}`, false);
    assert.equal((await inactive({ params: Promise.resolve({ id: 'owned-song' }) })).rendered, true);
  }
});
test('song action and Studio navigation use the server-provided flag', async () => {
  const action = await readFile('app/veyrnox/_components/music/MusicSongActions.jsx', 'utf8');
  assert.match(action, /const canStudio = enabled\.has\('open_studio'\);/);
  assert.match(action, /href=\{beatEditor \? `\/app\/music\/beats\/new\?song=\$\{encodeURIComponent\(songId\)\}` : `\/app\/music\/studio\/\$\{songId\}`\}/);
  assert.match(action, /\{beatEditor \? 'Open in Beats' : 'Open in Studio workspace'\}/);
  const nav = await readFile('app/veyrnox/_components/music/MusicPreviewShell.jsx', 'utf8');
  assert.match(nav, /entry.studio && beatsMode/);
});
