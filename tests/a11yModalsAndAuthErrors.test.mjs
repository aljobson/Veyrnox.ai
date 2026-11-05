import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateHarness } from './helpers/authGateHarness.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// LibraryPicker and DrawOnImage used to hand-roll role="dialog" aria-modal="true" with no focus
// trap, no Escape, no initial focus and no focus return. The shared Modal is a native <dialog>
// opened with showModal(), which supplies all of that and an inert background.
for (const file of ['LibraryPicker', 'DrawOnImage']) {
    test(`${file} uses the shared Modal instead of a hand-rolled dialog`, () => {
        const source = read(`app/veyrnox/_components/${file}.js`);
        assert.match(source, /import \{ Modal \} from '\.\/Modal';/);
        assert.match(source, /<Modal onCancel=\{(onClose|onCancel)\}/);
        assert.doesNotMatch(source, /role="dialog"/);
        assert.doesNotMatch(source, /aria-modal=/);
        assert.doesNotMatch(source, /addEventListener\('keydown'/, 'Escape is the Modal\'s job');
    });
}

test('LibraryPicker moves focus to a 44 px close button and names thumbnails by their label', () => {
    const source = read('app/veyrnox/_components/LibraryPicker.js');
    assert.match(source, /initialFocusRef=\{closeRef\}/);
    assert.match(source, /ref=\{closeRef\}[^>]*aria-label=\{t\("authGate\.close"\)\}/s);
    assert.match(source, /min-h-11 min-w-11/);
    assert.match(source, /onClick=\{\(\) => onPick\(it\)\} title=\{it\.label\} aria-label=\{it\.label\}/);
    assert.match(source, /<img [^>]*alt=""/);
    assert.match(source, /<span aria-hidden="true">♫<\/span>/);
});

test('while a sign-in error shows, both fields are described by it; with no error only the hint remains', async ctx => {
    const h = gateHarness(ctx, { signInWithPassword: async () => { throw new Error('Invalid login credentials'); } });
    h.open('sign_in'); h.email('person@test.invalid'); h.password('a-long-enough-password');
    assert.equal(h.field('email').props['aria-describedby'], undefined);
    assert.equal(h.field('password').props['aria-describedby'], 'vx-password-hint');
    h.token('captcha'); await h.submit(); h.render();
    assert.match(h.text(), /don't match/i);
    assert.equal(h.field('email').props['aria-describedby'], 'vx-auth-notice');
    assert.equal(h.field('password').props['aria-describedby'], 'vx-password-hint vx-auth-notice');
    assert.equal(h.find(n => n.props?.id === 'vx-auth-notice').props.role, 'status');
});
