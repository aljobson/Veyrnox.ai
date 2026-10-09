// What the chat page shows once its first load has ended. A closed flag, a signed-out reader and a failed load all
// leave the model list empty, and the page used to say "There are no chat models available right now." for each.
// The decision is a pure module; the screen itself is not importable here, so its wiring is pinned by reading the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_SCREEN_COPY, chatScreen, loadFailure } from '../app/veyrnox/_lib/chatScreen.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screen = read('../app/veyrnox/_components/chat/ChatWorkspace.js');

test('a failed load is sorted into closed, signed out, or failed', () => {
    assert.equal(loadFailure({ status: 503, code: 'chat_not_open' }), 'closed');
    // The gateway throws a 401 both when there is no token and when the server refused the one it sent.
    assert.equal(loadFailure({ status: 401, code: 'no_token' }), 'signed_out');
    assert.equal(loadFailure({ status: 401, code: 'unauthenticated' }), 'signed_out');
    assert.equal(loadFailure({ status: 429, code: 'rate_limited' }), 'failed');
    assert.equal(loadFailure({ status: 502, code: 'gateway_error' }), 'failed');
    assert.equal(loadFailure(new TypeError('Failed to fetch')), 'failed');
    assert.equal(loadFailure(undefined), 'failed');
});

test('a signed-out reader is told to sign in, not that chat has no models', () => {
    assert.equal(chatScreen({ closed: false, signedOut: true, loadFailed: false, modelCount: 0 }), 'signed_out');
    assert.match(CHAT_SCREEN_COPY.signed_out.title, /^Sign in/);
    assert.doesNotMatch(`${CHAT_SCREEN_COPY.signed_out.title} ${CHAT_SCREEN_COPY.signed_out.body}`, /not open|no chat models/i);
});

test('a load that failed says so and is not reported as "not open yet"', () => {
    assert.equal(chatScreen({ closed: false, signedOut: false, loadFailed: true, modelCount: 0 }), 'failed');
    assert.doesNotMatch(`${CHAT_SCREEN_COPY.failed.title} ${CHAT_SCREEN_COPY.failed.body}`, /not open|no chat models/i);
});

test('the closed flag and an empty catalog keep their existing wording', () => {
    assert.equal(chatScreen({ closed: true, signedOut: false, loadFailed: false, modelCount: 3 }), 'closed', 'closed wins even with models loaded');
    assert.equal(chatScreen({ closed: false, signedOut: false, loadFailed: false, modelCount: 0 }), 'no_models');
    assert.equal(CHAT_SCREEN_COPY.closed.title, 'LLM Chat is not open yet');
    assert.equal(CHAT_SCREEN_COPY.closed.body, 'We will open it here when it is ready.');
    assert.equal(CHAT_SCREEN_COPY.no_models.body, 'There are no chat models available right now.');
});

test('the order is closed, signed out, failed, then the model count', () => {
    assert.equal(chatScreen({ closed: true, signedOut: true, loadFailed: true, modelCount: 0 }), 'closed');
    assert.equal(chatScreen({ closed: false, signedOut: true, loadFailed: true, modelCount: 0 }), 'signed_out');
    // A session that ends while the workspace is open: the models are still in memory, but the reader is signed out.
    assert.equal(chatScreen({ closed: false, signedOut: true, loadFailed: false, modelCount: 3 }), 'signed_out');
    assert.equal(chatScreen({ closed: false, signedOut: false, loadFailed: false, modelCount: 3 }), 'ready');
});

test('every screen that is not the workspace has a title and a body', () => {
    for (const kind of ['closed', 'signed_out', 'failed', 'no_models']) {
        assert.ok(CHAT_SCREEN_COPY[kind].title && CHAT_SCREEN_COPY[kind].body, kind);
    }
    assert.equal(CHAT_SCREEN_COPY.ready, undefined);
});

test('the workspace asks the pure module which screen to show', () => {
    assert.match(screen, /import \{ CHAT_SCREEN_COPY, chatScreen, loadFailure \} from '\.\.\/\.\.\/_lib\/chatScreen';/);
    assert.match(screen, /const view = chatScreen\(\{ closed, signedOut, loadFailed, modelCount: models\.length \}\);/);
    assert.doesNotMatch(screen, /if \(closed \|\| models\.length === 0\)/, 'the empty model list is no longer the only test');
});

test('a 401 is no longer swallowed: it marks the reader signed out', () => {
    const fail = /const fail = useCallback\(\(e\) => \{\n([\s\S]*?)\n  \}, \[\]\);/.exec(screen);
    assert.ok(fail, 'fail() is a useCallback with no dependencies');
    assert.match(fail[1], /const why = loadFailure\(e\);/);
    assert.match(fail[1], /why === 'signed_out'\) setSignedOut\(true\)/);
    assert.match(fail[1], /return why;/, 'the first load reads the verdict');
});

test('only the first load turns a failure into the whole-page notice, and it can be tried again', () => {
    assert.match(screen, /if \(fail\(e\) === 'failed'\) setLoadFailed\(true\);/);
    assert.match(screen, /\}, \[fail, attempt\]\);/, 'the load effect runs again when the attempt changes');
    assert.match(screen, /setAttempt\(\(n\) => n \+ 1\)/);
    assert.match(screen, />Try again<\/button>/);
});

test('the signed-out screen opens the sign-in dialog the way the other app pages do', () => {
    assert.match(screen, /view === 'signed_out'[\s\S]{0,400}window\.dispatchEvent\(new CustomEvent\('veyrnox:auth-required'\)\)[\s\S]{0,40}>Sign in<\/button>/);
});
