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

// The weekly fal watch had findings to file on 2026-09-28 and 2026-10-05, then
// died on "could not add label: 'fal-drift' not found": nobody had made the
// label, so the run went red and no issue was opened.
test('the fal catalog watch makes its label before it files an issue under it', () => {
    const s = wf('fal-catalog-watch.yml');
    const made = s.indexOf('gh label create fal-drift');
    assert.ok(made > -1, 'never creates the fal-drift label');
    assert.ok(made < s.indexOf('gh issue create'), 'creates the label after the issue that needs it');
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
