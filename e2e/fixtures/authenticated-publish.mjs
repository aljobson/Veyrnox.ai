import { installProductFixtures, SYNTHETIC_USER } from './authenticated-product.mjs';

export const BRAND = '00000000-0000-4000-8000-000000000041';
export const SECOND_BRAND = '00000000-0000-4000-8000-000000000042';
export const LINK = { smartlink: { slug: 'synthetic-private', title: 'Synthetic private title', bio: 'Never publish this fixture', avatar_url: '', theme: 'midnight', published: false }, items: [{ id: 'synthetic-link', label: 'Synthetic destination', url: 'https://example.invalid/destination', enabled: true, clicks: 0 }], totals: { views: 3, clicks: 0 } };

/** Synthetic API contracts only. Unknown routes still fail the shared guard. */
export async function installPublishFixtures(page, options = {}) {
  if (options.preselect !== false) await page.context().addInitScript(({ accountId, brandId }) => localStorage.setItem('veyrnox_publish_team_brand', JSON.stringify({ accountId, brandId })), { accountId: SYNTHETIC_USER.id, brandId: BRAND });
  const writes = []; let link = structuredClone(LINK);
  const fixture = await installProductFixtures(page, { routes: async args => {
    const { url, method, body, json, origin, request } = args;
    if (url.origin !== origin) return false;
    if (await options.routes?.(args)) return true;
    const path = url.pathname.replace('/api/v1/social', '');
    if (!url.pathname.startsWith('/api/v1/social/')) return false;
    if (path === '/smartlink') {
      if (method === 'GET') return json(link);
      if (method === 'PUT') { writes.push({ body, brand: request.headers()['x-publish-brand-id'] }); link = { ...link, smartlink: { ...link.smartlink, ...body }, items: body.items }; return json({ ok: true }); }
    }
    if (method !== 'GET') return false;
    if (path === '/brands') return json({ brands: [{ id: BRAND, label: 'Synthetic brand', role: 'owner' }] });
    if (path === '/accounts') return json({ accounts: options.accounts || [], brandRole: options.role === undefined ? 'owner' : options.role, accountLimit: 5, planTier: 'publish', plansEnabled: true, inboxEnabled: true, inboxWorkflowsEnabled: true, smartlinksEnabled: true, queuesEnabled: true, teamsEnabled: true, reportsEnabled: true, adsEnabled: true, commerceEnabled: true, rssAutolistsEnabled: true, networks: [], ...options.accountFlags });
    const responses = {
      '/activity': { events: [], next_cursor: null }, '/ads': { campaigns: [], brandRole: 'owner' },
      '/posts': { posts: [], next_cursor: null }, '/drafts': { batches: [] }, '/approvals': { requests: [] },
      '/presets': { presets: [], brandRole: 'owner' }, '/uploads': { uploads: [] },
      '/autolists': { autolists: [], brandRole: 'owner' }, '/queues': { queues: [{ id: '00000000-0000-4000-8000-000000000061', name: 'Synthetic active queue', timezone: 'UTC', enabled: true, account_ids: ['00000000-0000-4000-8000-000000000052'], slots: [{ weekday: 1, time: '09:00' }] }], brandRole: 'owner' },
      '/calendar': { posts: [], next_cursor: null }, '/commerce/products': { products: [], brandRole: 'owner' },
      '/contacts': { contacts: [], brandRole: 'owner' }, '/inbox': { threads: [], counts: {}, next_cursor: null },
      '/inbox/analytics': { summary: {}, trend: [], platforms: [], heatmap: [] },
      '/developer/keys': { keys: [], enabled: true }, '/developer/webhooks': { webhooks: [], enabled: true }, '/developer/logs': { logs: [], enabled: true },
      '/reports': { templates: [], brandRole: 'owner', scheduledReportsEnabled: false, reportExportsEnabled: false, reportDeliveryEnabled: false },
      '/team': { brand_id: BRAND, brand_name: 'Synthetic brand', actor_role: 'owner', members: [], invitations: [] },
      '/workflows': { workflows: [], brandRole: 'owner' },
      '/plan': { enabled: true, consent_version: 'synthetic-only', entitlement: { tier: 'publish', account_limit: 5, subscription: { status: 'active', current_period_end: '2027-01-01T00:00:00Z', cancel_at_period_end: false, price_usd_cents: 1500 } }, plans: [] },
    };
    return Object.hasOwn(responses, path) ? json(responses[path]) : false;
  } });
  return { ...fixture, writes };
}
