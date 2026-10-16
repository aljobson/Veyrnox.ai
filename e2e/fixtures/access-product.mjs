import { installProductFixtures, SYNTHETIC_USER } from './authenticated-product.mjs';

export const TITLE_ID = '00000000-0000-4000-8000-000000000071';
export const ACTION_ID = '00000000-0000-4000-8000-000000000072';
export const ADMIN_PAGES = [
  ['', 'Last 24 hours', '/admin/metrics', 'By model'],
  ['/users', 'Account ledger', null, 'Find a user'],
  ['/violations', 'Content violations', '/admin/violations', 'Nothing recorded.'],
  ['/appeals', 'Content appeals', '/admin/appeals', 'No open appeals.'],
  ['/reports', 'Content reports', '/admin/reports', 'No open reports.'],
  ['/webhooks', 'Inbound webhooks', '/admin/webhooks', 'By source'],
  ['/cinema', 'Cinema creator applications', '/admin/cinema/creators', 'No pending applications.'],
  ['/cinema/submissions', 'Cinema publication queue', '/admin/cinema/submissions', 'Nothing is waiting for review.'],
  ['/cinema/comments', 'Cinema comment moderation', '/admin/cinema/comments', 'No comments awaiting approval.'],
  ['/cinema/voting', 'Cinema voting', '/admin/cinema/voting', 'No competitions yet.'],
  ['/cinema/story-polls', 'Cinema story polls', '/admin/cinema/story-polls', 'No story polls yet.'],
  ['/cinema/rankings', 'Weekly rankings', '/admin/cinema/rankings', 'No closed weeks or provisional rankings.'],
];

const ADMIN_READS = {
  '/admin/metrics': { generated_at: '2026-10-16T12:00:00Z', jobs_total: 0, models: [] },
  '/admin/violations': { violations: [] },
  '/admin/appeals': { appeals: [] },
  '/admin/reports': { reports: [], unavailable_scans_24h: 0, asset_gone_scans_24h: 0 },
  '/admin/webhooks': { by_source: [], failures: [], stuck_events: [] },
  '/admin/cinema/creators': { applications: [] },
  '/admin/cinema/submissions': { submissions: [] },
  '/admin/cinema/comments': { comments: [], reports: [] },
  '/admin/cinema/voting': { competitions: [], votes: [] },
  '/admin/cinema/story-polls': { polls: [], choices: [] },
  '/admin/cinema/rankings': { competitions: [], snapshots: [] },
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

/** Synthetic-only contracts. Unrecognized requests fall through to the shared abort-and-fail guard. */
export async function installAccessFixtures(page, options = {}) {
  const scenario = { adminError: null, adminFailures: 0, factorsError: false, oauthError: false, appealed: false, drafts: [], passOpen: false, titleLocked: true, ...options.scenario };
  if (options.preview) await page.context().addInitScript(() => localStorage.setItem('veyrnox_social_cinema', '1'));
  const fixture = await installProductFixtures(page, { ...options, routes: async args => {
    const { route, url, method, body, json, origin } = args;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': '*' };
    if (await options.routes?.({ ...args, scenario })) return true;
    if (url.origin === 'http://127.0.0.1:54321' && url.pathname.startsWith('/auth/v1/')) {
      if (method === 'OPTIONS') return json({}, 200, cors);
      if (url.pathname === '/auth/v1/user' && method === 'GET') return json(scenario.factorsError ? { msg: 'Synthetic authenticator read failure' } : { ...SYNTHETIC_USER, factors: [] }, scenario.factorsError ? 503 : 200, cors);
      if (url.pathname === '/auth/v1/user/oauth/grants' && method === 'GET') return json(scenario.oauthError ? { msg: 'Synthetic grant read failure' } : { grants: [] }, scenario.oauthError ? 503 : 200, cors);
      if (url.pathname === '/auth/v1/oauth/authorizations/synthetic-request' && method === 'GET') return json({ client: { client_name: 'Synthetic read-only assistant' }, scope: 'openid veyrnox:read' }, 200, cors);
      if (url.pathname === '/auth/v1/oauth/authorizations/synthetic-request/consent' && method === 'POST') return json({ msg: `Synthetic ${body.action} decision unavailable` }, 503, cors);
      return false;
    }
    const path = url.pathname.replace(/^\/api\/v1/, '');
    if (method === 'GET' && Object.hasOwn(ADMIN_READS, path)) {
      if (scenario.adminFailures > 0) { scenario.adminFailures--; return json({ error: 'temporarily_unavailable' }, 503); }
      if (scenario.adminError) return json({ error: scenario.adminError }, 403);
      return json(ADMIN_READS[path]);
    }
    if (path === '/admin/users/lookup' && method === 'GET') return scenario.adminError ? json({ error: scenario.adminError }, 403) : json({ user: { ...SYNTHETIC_USER, created_at: '2026-10-16T12:00:00Z', takedowns: 0, warnings: 0 }, balance: { balance: 1000, free_balance: 0, subscription_balance: 0 }, jobs: [] });
    if (path === '/admin/users/ledger' && method === 'GET') return json({ balance: { balance: 1000, free_balance: 0, subscription_balance: 0 }, entries: [], actions: [] });
    if (path === '/referrals' && method === 'GET') return json({ enabled: false });
    if (path === '/appeals' && method === 'GET') return json({ sanctions: options.sanction ? [{ action_id: ACTION_ID, action: 'warning', created_at: '2026-10-16T12:00:00Z', appeal_status: scenario.appealed ? 'open' : null }] : [] });
    if (path === '/appeals' && method === 'POST') { scenario.appealed = true; return json({ ok: true }); }
    if (path === '/reports' && method === 'POST') return json({ ok: true });
    if (path === '/cinema/content' && method === 'GET') return json({ content: scenario.drafts });
    if (path === '/cinema/content' && method === 'POST') { scenario.drafts = [...scenario.drafts, { ...body, id: TITLE_ID, revision: 1, lifecycle_status: 'DRAFT' }]; return json({ content: scenario.drafts.at(-1) }); }
    if (url.pathname === '/api/cinema-pass-plans' && method === 'GET') return json({ error: 'pass_not_open' }, scenario.passOpen ? 200 : 503);
    if (path === '/cinema/pass' && method === 'GET') return json({ pass: null });
    if (path === '/cinema/pass/plans' && method === 'GET') return json({ consent_version: 'synthetic-consent', plans: [{ id: 'synthetic-month', billing_interval: 'month', price_usd_cents: 1200 }] });
    if (path === '/cinema/pass' && method === 'POST') return json({ error: 'checkout_unavailable' }, 503);
    if ((path === `/cinema/titles/${TITLE_ID}` || url.pathname === `/api/cinema/titles/${TITLE_ID}`) && method === 'GET') return json({ title: { id: TITLE_ID, title: 'Synthetic isolated film', content_type: 'FILM', synopsis: 'An entirely synthetic title.', language: 'en', ai_disclosures: [], categories: [], duration_seconds: 60, access: scenario.titleLocked ? 'locked' : 'free', credits: 2, creator: { display_name: 'Synthetic creator' } } });
    if (path === '/cinema/entitlement' && method === 'GET') return json({ consent_version: 'synthetic-unlock-consent' });
    if (path === '/cinema/unlocks' && method === 'POST') return json({ error: 'insufficient_credits' }, 402);
    const cinemaGate = { '/cinema/retention': 'retention_not_open', '/cinema/voting': 'voting_not_open', '/cinema/comments': 'comments_not_open', '/cinema/story-polls': 'story_polls_not_open' };
    const publicCinemaPath = url.pathname.startsWith('/api/cinema/') ? url.pathname.slice(4) : path;
    if (url.origin === origin && Object.hasOwn(cinemaGate, publicCinemaPath) && method === 'GET') return json({ error: cinemaGate[publicCinemaPath] }, 503);
    if (url.pathname === '/api/cinema/discovery' && method === 'GET') return json({ mode: url.searchParams.get('mode'), titles: [], categories: [{ slug: 'science-fiction', label: 'Science fiction' }], next: null });
    if (url.pathname === '/api/cinema/winners' && method === 'GET') return json({ error: 'rankings_not_open' }, 503);
    if ((url.pathname.startsWith('/api/cinema/posters/') || url.pathname === '/_next/image' || url.origin === 'https://i.ytimg.com') && method === 'GET') { await route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); return true; }
    if (url.href === 'https://embed.cloudflarestream.com/embed/sdk.latest.js' && method === 'GET') { await route.fulfill({ contentType: 'application/javascript', body: 'window.Stream = () => ({currentTime:0,paused:true,ended:false,seeking:false,addEventListener(){},pause(){},destroy(){},play(){return Promise.resolve();}});' }); return true; }
    if (url.hostname === 'customer-synthetic.cloudflarestream.com' && url.pathname === '/synthetic.only.fixture/iframe' && method === 'GET') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic player, no media delivery</title><p>Isolated player fixture</p>' }); return true; }
    if (path === '/cinema/play' && method === 'POST') return json({ token: 'synthetic.only.fixture', customer_code: 'synthetic', expires_at: new Date(Date.now() + 900_000).toISOString(), watch_session_id: ACTION_ID });
    return false;
  } });
  return { ...fixture, scenario };
}
