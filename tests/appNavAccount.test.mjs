import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// JSX component, so this reads the source, like createAutoShort.test.mjs.
// Comments are stripped first: several of them explain the markup they sit
// above, and matching those would pass on the explanation, not the code.
const raw = readFileSync(new URL('../app/veyrnox/_components/NavBar.js', import.meta.url), 'utf8');
const src = raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const appNav = src.slice(src.indexOf('export function AppNav'));
const ternary = appNav.indexOf('{account ? (');
const elseArm = appNav.indexOf(') : (', ternary);
assert.ok(ternary > 0 && elseArm > ternary, 'AppNav must branch on the signed-in account');
const signedIn = appNav.slice(ternary, elseArm);
// The else arm runs to the end of the cluster; an inner `)}` would cut it
// short of the button it is supposed to be checking.
const signedOut = appNav.slice(elseArm, appNav.indexOf('</div>', elseArm));

test('signed out there is a sign-in affordance and no figures at all', () => {
    assert.match(signedOut, /Sign in/, 'must offer a way in');
    assert.match(signedOut, /veyrnox:auth-required/, 'must open the existing AuthGate, not a new screen');
    assert.ok(!signedOut.includes('Credit balance:'), 'no balance pill for a visitor with no balance');
    assert.ok(!signedOut.includes('Library assets:'), 'no asset count either');
    assert.ok(!/vx-money/.test(signedOut), 'nothing amber: there is no money to show');
});

test('signed in the top right names the account, the balance and the asset count', () => {
    assert.match(signedIn, /aria-label=\{`Credit balance: \$\{fmt\} credits`\}/);
    assert.match(signedIn, /aria-label=\{`Library assets: \$\{assetFmt\}`\}/);
    // The account element opens the menu the marketing nav already ships
    // (who you are, links into the app, Sign out) rather than a new one.
    assert.match(signedIn, /<NavAuthButtons \/>/);
    assert.match(src, /import \{ NavAuthButtons \} from '\.\/NavAuthButtons';/);
    assert.match(signedIn, /href="\/app\/credits"/, 'the balance links to Credits');
    assert.match(signedIn, /href="\/app\/library"/, 'the count links to Library');
});

test('neither figure is a bare number to a screen reader', () => {
    // Both digits sit in their own element; the meaning is on the link.
    for (const label of ['Credit balance: ', 'Library assets: ']) {
        assert.ok(signedIn.includes(`aria-label={\`${label}`), `${label} needs a spoken label`);
    }
    assert.match(signedIn, /aria-hidden="true" className="h-1\.5 w-1\.5 rounded-full bg-vx-money"/,
        'the amber dot is decoration, not content');
});

test('the balance still follows veyrnox:balance-changed, and so does the count', () => {
    assert.equal((appNav.match(/addEventListener\('veyrnox:balance-changed'/g) || []).length, 2,
        'balance and asset count both subscribe');
    assert.equal((appNav.match(/removeEventListener\('veyrnox:balance-changed'/g) || []).length, 2,
        'and both unsubscribe');
    assert.match(appNav, /const b = await gatewayFetch\('\/balance'\)/, 'balance stays a gateway read');
});

test('the asset count comes from the list Library already reads', () => {
    // No new API route and no migration for this: the gateway has no
    // jobs-list endpoint, so the count is the client-side ring buffer.
    assert.match(src, /import \{ readJobHistory \} from '\.\.\/_lib\/jobHistory';/);
    assert.match(appNav, /setAssets\(readJobHistory\(\)\.length\)/);
    // null until mount, so the server and client markup agree.
    assert.match(appNav, /const \[assets, setAssets\] = useState\(null\);/);
    assert.match(appNav, /const \[account, setAccount\] = useState\(null\);/);
});

test('amber means credits and nothing else', () => {
    assert.equal((signedIn.match(/text-vx-money/g) || []).length, 1, 'only the credit figure is amber');
    assert.equal((signedIn.match(/bg-vx-money/g) || []).length, 1, 'only the credit dot is amber');
    assert.match(signedIn, /text-vx-fg-body vx-num">\{assetFmt\}/, 'the asset count is body text');
});

test('the whole nav still fits a phone', () => {
    // Measured: side by side the two figures need 459px of nav and a 360px
    // phone gives 328. Stacked, with the mark yielding to them below sm,
    // it is 348. Signed out nothing stacks and the mark stays.
    assert.match(signedIn, /flex flex-col gap-px/, 'the two figures stack');
    assert.match(appNav, /\$\{account \? 'hidden sm:flex' : 'flex'\}/,
        'the mark yields to the account block below sm, and only then');
    assert.match(appNav, /className="flex gap-0\.5 sm:gap-1 text-\[12px\] sm:text-sm font-semibold"/,
        'the tabs stay compact below sm');
});
