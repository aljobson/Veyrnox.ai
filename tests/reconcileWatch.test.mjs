import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/reconcile-watch.yml', import.meta.url), 'utf8');

test('reconcile watcher retains several timestamped count samples per hour', () => {
    assert.match(workflow, /cron: '7,22,37,52 \* \* \* \*'/);
    assert.match(workflow, /reconciliation_observed_at=/);
    assert.match(workflow, /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
    assert.match(workflow, /retention-days: 90/);
    assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/);
});
