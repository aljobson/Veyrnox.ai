import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A monitor that only exits non-zero is not an alert: someone has to be
// watching the Actions tab. The ledger and migration monitors each file one
// labelled issue per episode; the signup gate — which guards a 50-credit
// faucet — did not (audit 2026-09-23).
const wf = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('every production monitor can open an issue when it goes red', () => {
    for (const [file, label] of [
        ['reconcile-watch.yml', 'ledger-drift'],
        ['migration-ledger.yml', 'migration-drift'],
        ['signup-gate.yml', 'signup-gate'],
    ]) {
        const s = wf(file);
        assert.match(s, /issues: write/, `${file}: no issue permission`);
        assert.match(s, /gh issue create/, `${file}: never creates an issue`);
        assert.ok(s.includes(label), `${file}: no ${label} label`);
        // One issue per episode, not one per hourly run.
        assert.match(s, /gh issue list --label/, `${file}: would file a duplicate every run`);
        // Only from main, so a branch cannot file noise.
        assert.match(s, /github\.ref == 'refs\/heads\/main'/, `${file}: not scoped to main`);
    }
});

test('the signup gate treats "could not check" as not-a-pass, and says which it was', () => {
    const s = wf('signup-gate.yml');
    // The check itself already distinguishes the three states.
    assert.match(s, /state=closed/);
    assert.match(s, /state=open/);
    assert.match(s, /state=unknown/);
    // The alert fires for anything that is not closed.
    assert.match(s, /needs\.check\.outputs\.state != 'closed'/);
    // And the copy differs, because the remedies differ.
    assert.match(s, /faucet is OPEN/);
    assert.match(s, /could not be checked/);
});
