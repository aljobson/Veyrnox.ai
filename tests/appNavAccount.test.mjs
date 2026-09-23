import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
});

const accountRoute = await import('../app/api/v1/account/route.js');

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
    // (who you are, links into the app, Sign out) rather than a new one,
    // and is named from the endpoint rather than a stale session copy.
    assert.match(signedIn, /<NavAuthButtons account=\{account\} \/>/);
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

test('the summary follows veyrnox:balance-changed', () => {
    assert.equal((appNav.match(/addEventListener\('veyrnox:balance-changed'/g) || []).length, 1,
        'one read now carries balance and count, so one subscription');
    assert.equal((appNav.match(/removeEventListener\('veyrnox:balance-changed'/g) || []).length, 1,
        'and it unsubscribes');
});

test('name, email, credits and assets all come from the endpoint', () => {
    assert.match(appNav, /await gatewayFetch\('\/account'\)/, 'one gateway read for the lot');
    assert.match(appNav, /const assets = summary\?\.assets \?\? null;/, 'the count is the server count');
    assert.match(appNav, /summary\?\.credits/, 'the balance is the server balance');
    assert.match(appNav, /summary\?\.name \|\| summary\?\.email/, 'name if present, else email');
    // The browser-local ring buffer is capped at 50 and empty on a fresh
    // browser — it was never the account's real asset count.
    assert.ok(!/readJobHistory/.test(raw), 'the nav must not count job history any more');
    // null until mount, so the server and client markup agree.
    assert.match(appNav, /const \[summary, setSummary\] = useState\(null\);/);
    assert.match(appNav, /const \[session, setSession\] = useState\(null\);/);
});

test('a raw id never reaches the header, and a failed read never lies', () => {
    // accountLabel only ever yields name/email/initial, and the endpoint's
    // fallback chain ends at the email — no branch reaches an id.
    assert.ok(!/auth-id|\.sub\b|user_id/.test(appNav), 'no identifier in the rendered label');
    assert.match(appNav, /if \(e instanceof GatewayError && e\.status === 401\) setSummary\(null\);/,
        'signed out clears the figures; any other failure keeps the last good read');
    assert.match(appNav, /assets != null \? new Intl\.NumberFormat/, 'no count renders as an em dash');
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

// ── GET /api/v1/account ───────────────────────────────────────────────────

const AUTH_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = '99999999-8888-4777-8666-555555555555';

function accountRequest(headers = {}) {
    return new Request('https://veyrnox.test/api/v1/account', { headers });
}

function stubFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push(u);
        for (const [needle, reply] of routes) {
            if (u.includes(needle)) return typeof reply === 'function' ? reply(u, init) : Response.json(reply);
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

const countingRoutes = (total = 48) => [
    ['/rpc/read_user_credits', { balance: 1199, free_credits: 0, free_expires_at: null }],
    ['/rest/v1/users', [{ id: USER_ID, email: 'row@veyrnox.test' }]],
    ['/rest/v1/assets', () => new Response('[{"id":"a1"}]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-range': `0-0/${total}` },
    })],
];

test('no verified identity header is 401 not_authenticated, never a 500', async () => {
    globalThis.fetch = async () => { throw new Error('must not touch the database'); };
    for (const headers of [{}, { 'x-veyrnox-auth-id': 'not-a-uuid' }, { 'x-veyrnox-auth-id': '' }]) {
        const res = await accountRoute.GET(accountRequest(headers));
        assert.equal(res.status, 401);
        assert.deepEqual(await res.json(), { error: 'not_authenticated' });
    }
});

test('the summary is email, name, credits and a server-side asset count', async () => {
    stubFetch(countingRoutes());
    const res = await accountRoute.GET(accountRequest({
        'x-veyrnox-auth-id': AUTH_ID,
        'x-veyrnox-auth-email': 'owner@veyrnox.test',
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
        email: 'owner@veyrnox.test',
        // public.users has no display-name column, and this route adds no
        // migration — so the UI falls back to the email.
        name: null,
        credits: 1199,
        assets: 48,
    });
    assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('the count is scoped to the caller, and only ever costs one row', async () => {
    const calls = stubFetch(countingRoutes());
    await accountRoute.GET(accountRequest({ 'x-veyrnox-auth-id': AUTH_ID }));

    const users = calls.find((u) => u.includes('/rest/v1/users'));
    assert.ok(users.includes(`auth_id=eq.${AUTH_ID}`), 'the user is looked up by the verified sub');

    const assets = decodeURIComponent(calls.find((u) => u.includes('/rest/v1/assets')));
    assert.ok(assets.includes('jobs!inner(user_id)'), 'assets reach the user through their jobs');
    assert.ok(assets.includes(`jobs.user_id=eq.${USER_ID}`), 'and only that user');
    assert.ok(assets.includes('limit=1'), 'the rows are never pulled, only counted');
});

test('the email falls back to the users row when the token carried none', async () => {
    stubFetch(countingRoutes());
    const res = await accountRoute.GET(accountRequest({ 'x-veyrnox-auth-id': AUTH_ID }));
    assert.equal((await res.json()).email, 'row@veyrnox.test');
});

test('a count that fails costs the count, not the balance', async () => {
    stubFetch([
        ['/rpc/read_user_credits', { balance: 1199 }],
        ['/rest/v1/users', [{ id: USER_ID, email: 'row@veyrnox.test' }]],
        ['/rest/v1/assets', () => new Response('nope', { status: 500 })],
    ]);
    const res = await accountRoute.GET(accountRequest({ 'x-veyrnox-auth-id': AUTH_ID }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.credits, 1199, 'the balance still shows');
    assert.equal(body.assets, null, 'and the count renders as an em dash rather than a wrong number');
});

test('a user with no row yet reads zero, not an error', async () => {
    stubFetch([
        ['/rpc/read_user_credits', { balance: 0 }],
        ['/rest/v1/users', []],
    ]);
    const res = await accountRoute.GET(accountRequest({ 'x-veyrnox-auth-id': AUTH_ID }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { email: null, name: null, credits: 0, assets: null });
});

test('a database failure is a typed 502, not a leaked message', async () => {
    stubFetch([
        ['/rpc/read_user_credits', () => new Response('permission denied for relation users', { status: 403 })],
        ['/rest/v1/users', []],
    ]);
    const res = await accountRoute.GET(accountRequest({ 'x-veyrnox-auth-id': AUTH_ID }));
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'internal' });
});
