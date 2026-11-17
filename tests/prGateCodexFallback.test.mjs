import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// pr gate falls back to OpenAI Codex when the Claude review returns no verdict.
const wf = readFileSync(new URL('../.github/workflows/pr-gate.yml', import.meta.url), 'utf8');

test('the Claude review may fail without failing the job; Codex runs only when it gave no verdict', () => {
    assert.match(wf, /id: review\n\s+if: steps\.key\.outputs\.claude == 'true'\n\s+continue-on-error: true/);
    assert.match(wf, /steps\.key\.outputs\.claude != 'true' \|\| steps\.review\.outputs\.structured_output == ''/);
});

test('Codex is pinned to a commit, read-only, and reads the same instructions file', () => {
    assert.match(wf, /uses: openai\/codex-action@[0-9a-f]{40} # v/);
    assert.match(wf, /permission-profile: ':read-only'/);
    assert.match(wf, /prompt-file: \$\{\{ steps\.prompt\.outputs\.file \}\}/);
    assert.doesNotMatch(wf, /safety-strategy: '?(unsafe|read-only)'?/);
    // drop-sudo fails on Ubuntu 26.04 (openai/codex-action#188); keep the job on 24.04.
    assert.match(wf, /runs-on: ubuntu-24\.04/);
});

test('the posted verdict says which reviewer produced it and still fails on no verdict or BLOCK', () => {
    assert.match(wf, /REVIEWER="Codex \(fallback\)"/);
    assert.match(wf, /no reviewer returned a structured result/);
    assert.match(wf, /if \[ "\$verdict" = "BLOCK" \]; then/);
});

test('the rules are still read from the base branch, never the PR', () => {
    assert.match(wf, /git show origin\/__BASE__:CLAUDE\.md/);
    assert.match(wf, /sed -i "s\|__BASE__\|\$\{BASE\}\|g"/);
});

test('a reviewer stopped by billing is named in the error, not just "no result"', () => {
    assert.match(wf, /- name: Why the review failed\n\s+id: why\n/);
    assert.match(wf, /test\("credit balance\|billing\|quota\|spend limit\|insufficient"; "i"\)/);
    assert.match(wf, /CLAUDE_BILLING: \$\{\{ steps\.why\.outputs\.billing \}\}/);
    assert.match(wf, /CODEX_OUTCOME: \$\{\{ steps\.codex\.outcome \}\}/);
    assert.match(wf, /is out of credit; top it up/);
    assert.match(wf, /Quota exceeded/);
});
