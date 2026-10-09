import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Both files are JSX, so these read the source, like authCaptcha.test.mjs.
const marks = readFileSync(new URL('../components/AuthMarks.jsx', import.meta.url), 'utf8');
const authGate = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');

const NAMES = ['AppleMark', 'PasskeyMark', 'GoogleMark'];

test('the three sign-in marks are defined in AuthMarks.jsx', () => {
    for (const name of NAMES) {
        assert.match(marks, new RegExp(`^export function ${name}\\(\\) \\{$`, 'm'), `${name} is exported`);
    }
    // Decorative: each button's text is its accessible name.
    assert.equal(marks.match(/<svg aria-hidden="true" focusable="false"/g).length, NAMES.length);
});

test('AuthMarks.jsx imports nothing', () => {
    // It is on AuthGate's import graph, which the root layout mounts. Markup
    // only keeps it clear of the bundler traps in CLAUDE.md.
    assert.doesNotMatch(marks, /^\s*import\s/m);
    assert.doesNotMatch(marks, /require\(/);
});

test('AuthGate imports the marks instead of defining them', () => {
    assert.match(authGate, /^import \{ AppleMark, PasskeyMark, GoogleMark \} from "\.\/AuthMarks\.jsx";$/m);
    for (const name of NAMES) {
        assert.doesNotMatch(authGate, new RegExp(`function ${name}\\b`), `${name} is not defined in AuthGate.jsx`);
        assert.equal(authGate.split(`<${name} />`).length - 1, 1, `${name} is rendered once`);
    }
    assert.doesNotMatch(authGate, /<svg\b/, 'no inline SVG left in AuthGate.jsx');
});

test('AuthGate has room under the 500-line ceiling', () => {
    // turnstileFailure.test.mjs holds the ceiling itself. This one fails first,
    // while there is still room to move something else out of the file.
    const ROOM = 20;
    assert.ok(authGate.split('\n').length <= 500 - ROOM, `keep ${ROOM} lines of room in AuthGate.jsx`);
});
