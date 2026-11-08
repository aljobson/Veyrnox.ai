import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';
import { EDITOR_INTENTS } from '../app/veyrnox/_lib/editorIntentRouter.mjs';
const keys = Object.keys(await appMessagesFor('en')).filter(key => key.startsWith('app.editor.simple.'));
test('all simple editor copy and advertised actions exist in each of the eleven own catalogs', async () => {
    assert.equal(LOCALES.length, 11);
    for (const { code } of LOCALES) {
        // Own area import, so fallback cannot conceal an untranslated entry.
        const { default: own } = await import(`../lib/i18n/messages/app/${code}/editor-workspace.mjs`);
        for (const key of keys) {
            assert.equal(typeof own[key], 'string', `${code}/${key}`);
            assert.ok(own[key].trim());
        }
        assert.equal(own['app.editor.simple.ask'], own['app.editor.simple.describe'], code);
        assert.ok(own['app.editor.simple.usePrompt']);
        for (const intent of Object.keys(EDITOR_INTENTS)) assert.ok(own[`app.editor.simple.intent.${intent}`]);
        const native = readFileSync(new URL(code === 'en' ? '../apps/mobile/src/lib/i18n/messages/en/editorSimple.ts' : `../apps/mobile/src/lib/i18n/messages/app/${code}.ts`, import.meta.url), 'utf8');
        const heading = JSON.parse(native.match(/\"editorSimple.aiTitle\": (\".*\")/)[1]);
        const entry = JSON.parse(native.match(/\"editorSimple.describe\": (\".*\")/)[1]);
        assert.equal(heading, entry, code);
        for (const suffix of ['describe', 'promptHelp', 'openTool', 'unsupported']) assert.ok(native.includes(`"editorSimple.${suffix}":`), `${code}/${suffix}`);
    }
});
