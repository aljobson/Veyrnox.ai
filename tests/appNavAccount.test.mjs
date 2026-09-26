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
const { accountLabel } = await import('../app/veyrnox/_lib/account.js');

// JSX component, so this reads the source, like createAutoShort.test.mjs.
// Comments are stripped first: several of them explain the markup they sit
// above, and matching those would pass on the explanation, not the code.
const strip = (t) => t
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
// AppNav puts the name on the bar by passing `account` to this button, so
// the name's own markup lives here.
const authSrc = strip(readFileSync(new URL('../app/veyrnox/_components/NavAuthButtons.js', import.meta.url), 'utf8'));
const raw = readFileSync(new URL('../app/veyrnox/_components/NavBar.js', import.meta.url), 'utf8');
const src = strip(raw);

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
    assert.ok(!signedOut.includes('in your library'), 'no asset count either');
    assert.ok(!/vx-money/.test(signedOut), 'nothing amber: there is no money to show');
});

test('signed in the top right names the account, the balance and the asset count', () => {
    assert.match(signedIn, /aria-label=\{`Credit balance: \$\{fmt\} credits`\}/);
    assert.match(signedIn, /aria-label=\{`\$\{assetFmt\} \$\{assetWord\} in your library`\}/);
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
    assert.ok(signedIn.includes('aria-label={`Credit balance: '), 'the balance needs a spoken label');
    assert.ok(signedIn.includes('in your library`}'), 'and the count needs one that reads as a sentence');
    assert.match(signedIn, /aria-hidden="true" className="h-1\.5 w-1\.5 rounded-full bg-vx-money"/,
        'the amber dot is decoration, not content');
});

test('the summary follows veyrnox:balance-changed', () => {
    assert.equal((appNav.match(/addEventListener\('veyrnox:balance-changed'/g) || []).length, 1,
        'one read now carries balance and count, so one subscription');
    assert.equal((appNav.match(/removeEventListener\('veyrnox:balance-changed'/g) || []).length, 1,
        'and it unsubscribes');
});

test('credits and assets come from the endpoint, the name from the session', () => {
    assert.match(appNav, /await gatewayFetch\('\/account'\)/, 'one gateway read for the lot');
    assert.match(appNav, /const assets = summary\?\.assets \?\? null;/, 'the count is the server count');
    assert.match(appNav, /summary\?\.credits/, 'the balance is the server balance');
    // The display name is the signed-in session's; the endpoint has none to
    // give (no display-name column) and only backs the email.
    assert.match(appNav, /const account = accountLabel\(session, summary\?\.email \|\| ''\);/);
    assert.ok(!/summary\?\.name/.test(appNav), 'the endpoint returns no name to read');
    // The browser-local ring buffer is capped at 50 and empty on a fresh
    // browser — it was never the account's real asset count.
    assert.ok(!/readJobHistory/.test(raw), 'the nav must not count job history any more');
    // null until mount, so the server and client markup agree.
    assert.match(appNav, /const \[summary, setSummary\] = useState\(null\);/);
    assert.match(appNav, /const \[session, setSession\] = useState\(null\);/);
});

// What the header actually renders, through the helper AppNav calls.
test('the header shows the name the session carries', () => {
    const google = { user: { email: 'al@x.co', user_metadata: { full_name: 'Al Jobson' } } };
    assert.deepEqual(accountLabel(google, 'al@x.co'), { name: 'Al Jobson', email: 'al@x.co', initial: 'A' });
});

test('an email sign-up carries no name, so the header shows the address', () => {
    const signup = { user: { email: 'jo.smith@x.co', user_metadata: {} } };
    const a = accountLabel(signup, 'jo.smith@x.co');
    assert.equal(a.name, 'jo.smith', 'the address, never a user id');
    assert.equal(a.email, 'jo.smith@x.co');
});

test('a session with no email at all falls back to the endpoint\u2019s', () => {
    const a = accountLabel({ user: null, access_token: 'not-a-jwt' }, 'row@veyrnox.test');
    assert.deepEqual(a, { name: 'row', email: 'row@veyrnox.test', initial: 'R' });
    // And with nothing anywhere it is still a label, not a blank.
    assert.equal(accountLabel({ user: null, access_token: 'not-a-jwt' }).name, 'Account');
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
    assert.match(appNav, /className="flex [^"]*gap-0\.5 sm:gap-1 text-\[12px\] sm:text-sm font-semibold"/,
        'the tabs stay compact below sm');
    assert.match(appNav, /<nav[^>]*min-w-0 overflow-x-auto/,
        'preview tabs can scroll without pushing account controls off a phone');
});

// One asset is not "1 assets". Run the component's own two lines rather
// than a copy of them, so the branch is what is under test.
function figures(assets) {
    const decl = appNav.slice(appNav.indexOf('const assetFmt ='), appNav.indexOf('return (', appNav.indexOf('const assetFmt =')));
    return new Function('assets', `${decl} return assetFmt + ' ' + assetWord;`)(assets);
}

test('the count is singular at one and plural everywhere else', () => {
    assert.equal(figures(0), '0 assets');
    assert.equal(figures(1), '1 asset');
    assert.equal(figures(2), '2 assets');
    assert.equal(figures(1000), '1,000 assets', 'still grouped');
    assert.equal(figures(null), '— assets', 'an unanswered read is still an em dash');
    // Both the visible word and the spoken label use the same one.
    assert.match(signedIn, /text-vx-fg-muted">\{assetWord\}<\/span>/);
});

test('the bar names the account beside the avatar, and hides that name below sm', () => {
    assert.match(signedIn, /<NavAuthButtons account=\{account\} \/>/, 'the nav hands the label over');
    // Not only inside the menu: the name is on the bar itself, next to the
    // initial. The menu's own copy is a <div>, so this span is the bar's.
    const span = authSrc.match(/<span className="([^"]*)">\{account\.name\}<\/span>/);
    assert.ok(span, 'the name is rendered on the bar');
    const cls = span[1];
    assert.match(cls, /\bhidden\b/, 'below sm the tabs and the stacked figures already fill the bar');
    assert.match(cls, /\bsm:(inline|inline-block|block|flex)\b/, 'and it comes back at sm');
    assert.match(cls, /\btruncate\b/, 'a long name is cut, never wrapped');
    assert.match(cls, /max-w-\[\d+(\.\d+)?rem\]/, 'and cut at a fixed width');
    // `truncate` only bites on a block box. It works here because the span
    // is a direct child of the flex button, which blockifies it — move it
    // out of that row and the ellipsis silently stops.
    const button = authSrc.slice(authSrc.indexOf('aria-haspopup="menu"'), authSrc.indexOf(span[0]));
    assert.match(button, /className="flex items-center/, 'the name sits in the flex row that blockifies it');
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

test('the summary is email, credits and a server-side asset count', async () => {
    stubFetch(countingRoutes());
    const res = await accountRoute.GET(accountRequest({
        'x-veyrnox-auth-id': AUTH_ID,
        'x-veyrnox-auth-email': 'owner@veyrnox.test',
    }));
    assert.equal(res.status, 200);
    // No `name`: public.users has no display-name column, and the browser
    // already holds the one Google gave it, in the session.
    assert.deepEqual(await res.json(), {
        email: 'owner@veyrnox.test',
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
    assert.deepEqual(await res.json(), { email: null, credits: 0, assets: null });
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
