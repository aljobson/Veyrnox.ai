// .github/workflows/detection-watch.yml (ADR-0310): the security engine's
// out-of-band alarm, mirroring reconcile-watch.yml.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/detection-watch.yml', import.meta.url), 'utf8');

test('the watcher runs off-peak each quarter-hour and keeps every sample', () => {
    assert.match(workflow, /cron: '4,19,34,49 \* \* \* \*'/);
    assert.match(workflow, /detection_observed_at=/);
    assert.match(workflow, /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
    assert.match(workflow, /retention-days: 90/);
    assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/);
});

test('it reads with the service-role key, not an anon key', () => {
    assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
    assert.match(workflow, /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/);
    assert.doesNotMatch(workflow, /ANON_KEY/);
});

test('only exit 1 on main files an issue; an outage (exit 2) does not', () => {
    assert.match(workflow, /needs\.detection\.outputs\.exit == '1' && github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /gh issue list --label security-detection --state open/);
    // issues: write is scoped to the reporting job only
    assert.match(workflow, /report-attention:[\s\S]*permissions:\s*\n\s*issues: write/);
    assert.match(workflow, /detection:[\s\S]*permissions:\s*\n\s*contents: read/);
});

test('untrusted text is passed through env, never interpolated into the shell', () => {
    assert.match(workflow, /REPORT: \$\{\{ needs\.detection\.outputs\.report \}\}/);
    assert.match(workflow, /"\$REPORT"/);
});
