import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => resolveI18nSource(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('Publish does not show a guessed account allowance while access is loading', () => {
    const source = read('app/veyrnox/app/publish/page.js');
    assert.match(source, /const \[accountLimit, setAccountLimit\] = useState\(null\);/);
    assert.match(source, /if \(accounts === null\) return[\s\S]*Loading connected accounts and plan/);
    assert.ok(
        source.indexOf('if (accounts === null) return') < source.indexOf("t(canManageAccounts ? 'app.publish.connect.yourPlan'"),
        'the loading return must run before capacity copy can render',
    );
});

test('Publish schedule input advertises the future boundary enforced on submit', () => {
    const source = read('app/veyrnox/app/publish/Composer.js');
    assert.match(source, /min=\{minimumFutureLocalInput\(\)\}/);
    assert.match(source, /const schedule = futureLocalSchedule\(scheduledAt\);/);
    assert.match(source, /if \(!publishNow && !useQueue && !schedule\)/);
    assert.match(source, /value="now" formNoValidate/);
    assert.match(source, /value="queue" formNoValidate/);
});
