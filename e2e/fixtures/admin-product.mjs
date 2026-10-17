import { installAccessFixtures, ACTION_ID, TITLE_ID } from './access-product.mjs';
import { SYNTHETIC_USER } from './authenticated-product.mjs';

export const ADMIN_IDS = Object.freeze({
  alert: '00000000-0000-4000-8000-000000000081',
  duplicateAlert: '00000000-0000-4000-8000-000000000082',
  resolvedAlert: '00000000-0000-4000-8000-000000000083',
  falsePositiveAlert: '00000000-0000-4000-8000-000000000084',
  application: '00000000-0000-4000-8000-000000000085',
  submission: '00000000-0000-4000-8000-000000000086',
  comment: '00000000-0000-4000-8000-000000000087',
  report: '00000000-0000-4000-8000-000000000088',
  competition: '00000000-0000-4000-8000-000000000089',
  poll: '00000000-0000-4000-8000-000000000090',
});
const AT = '2026-10-17T09:54:00Z';
const person = { display_name: 'Synthetic moderator subject', username: 'synthetic-subject' };

export function adminReadFixtures() {
  const alert = { rule_id: 'SEC-003', entity: 'admin.mfa_required', title: 'Historical synthetic alert', severity: 'high', event_count: 1, first_seen: AT, last_seen: AT, tags: ['attack.t1078'], status: 'open' };
  const action = { id: ACTION_ID, created_at: AT, action: 'warning', email: SYNTHETIC_USER.email, actor: 'synthetic-admin@example.invalid', reason: 'Synthetic existing warning' };
  return {
    '/admin/metrics': { generated_at: AT, generating_users: 1, jobs_total: 3, jobs_failed: 1, credits_debited: 10, credits_refunded: 2, models: [{ model_id: 'synthetic-model', jobs: 3, stored: 2, failed: 1, p95_seconds: 12 }] },
    '/admin/security': {
      alerts: [
        { ...alert, id: ADMIN_IDS.alert }, { ...alert, id: ADMIN_IDS.duplicateAlert },
        { ...alert, id: ADMIN_IDS.resolvedAlert, title: 'Resolved synthetic alert', status: 'resolved' },
        { ...alert, id: ADMIN_IDS.falsePositiveAlert, title: 'False positive synthetic alert', status: 'false_positive' },
      ],
      open_by_severity: { high: 2 },
      recent_events: [{ created_at: AT, category: 'access', action: 'admin.mfa_required', status: 403, path: '/api/v1/admin/metrics', reason: 'mfa_required' }],
    },
    '/admin/users/lookup': { user: { ...SYNTHETIC_USER, created_at: AT, warnings: 1, takedowns: 0 }, jobs: [{ job_id: TITLE_ID, model_id: 'synthetic-model', state: 'DONE', created_at: AT, has_asset: true }] },
    '/admin/users/ledger': { balance: { balance: 1000, free_balance: 100, subscription_balance: 200 }, entries: [{ id: ACTION_ID, created_at: AT, delta: 10, free_delta: 0, subscription_delta: 0, reason: 'Synthetic existing credit movement' }], actions: [action] },
    '/admin/violations': { violations: [action] },
    '/admin/appeals': { appeals: [{ id: ACTION_ID, action_id: ACTION_ID, user_id: SYNTHETIC_USER.id, email: SYNTHETIC_USER.email, submitted_at: AT, action_at: AT, action: 'warning', action_actor: action.actor, action_reason: action.reason, statement: 'Synthetic appeal statement', standing_takedowns: 0, status: 'open' }] },
    '/admin/reports': { reports: [{ id: ADMIN_IDS.report, category: 'other', subject_kind: 'other', source: 'user', reporter_email: 'synthetic-reporter@example.invalid', created_at: AT, status: 'open', details: 'Synthetic report details, no real content' }], unavailable_scans_24h: 2, asset_gone_scans_24h: 1 },
    '/admin/webhooks': { by_source: [{ source: 'synthetic-provider', total: 4, accepted: 2, duplicate: 1, other_ok: 0, rejected_signature: 1, rejected: 0, unavailable: 0, failed: 0, last_bad_at: AT }], failures: [{ id: ACTION_ID, created_at: AT, source: 'synthetic-provider', outcome: 'rejected_signature', http_status: 401, error: 'Synthetic signature refusal' }], stuck_events: [{ created_at: AT, source: 'synthetic-provider', external_id: 'synthetic-stuck-event' }] },
    '/admin/cinema/creators': { applications: [{ id: ADMIN_IDS.application, ...person, statement: 'Synthetic creator application, no identity document' }] },
    '/admin/cinema/submissions': { submissions: [{ id: ADMIN_IDS.submission, content_id: TITLE_ID, title: 'Synthetic publication submission', ...person, content_type: 'FILM', language: 'en', duration_seconds: 60, synopsis: 'Synthetic private fixture', categories: [], audience_rating: 'general', rights_version: 'synthetic-rights', content_status: 'passed', child_safety_status: 'passed', malware_status: 'passed' }] },
    '/admin/cinema/comments': { comments: [{ id: ADMIN_IDS.comment, content_id: TITLE_ID, title: 'Synthetic comment title', ...person, created_at: AT, body: 'Synthetic held comment' }], reports: [{ id: ADMIN_IDS.report, comment_id: ADMIN_IDS.comment, title: 'Synthetic reported comment', category: 'other', body: 'Synthetic approved comment', details: 'Synthetic report explanation', comment_status: 'approved' }] },
    '/admin/cinema/voting': { competitions: [{ id: ADMIN_IDS.competition, name: 'Synthetic competition', starts_at: AT, ends_at: '2026-10-24T09:54:00Z', target_types: ['FILM'], status: 'open' }], votes: [{ id: ACTION_ID, title: 'Synthetic held vote', ...person, created_at: AT }] },
    '/admin/cinema/story-polls': { polls: [{ id: ADMIN_IDS.poll, question: 'Synthetic story question?', title: 'Synthetic poll title', opens_at: AT, closes_at: '2026-10-24T09:54:00Z', status: 'open' }], choices: [{ id: ACTION_ID, title: 'Synthetic held story choice', ...person, created_at: AT, question: 'Synthetic question?', label: 'Synthetic answer' }] },
    '/admin/cinema/rankings': { competitions: [{ id: ADMIN_IDS.competition, name: 'Synthetic closed week' }], snapshots: [{ id: ACTION_ID, name: 'Synthetic provisional ranking', status: 'provisional', own: true, model_version: 'synthetic-v1', rows: [{ content_id: TITLE_ID, rank: 1, title: 'Synthetic ranked film', score: 3.5, signals: { votes: 1, viewers: 2, completions: 1, shares: 0, engagement: 0 } }] }] },
  };
}

/** Read-only populated contracts. Every admin write must be explicitly intercepted by its individual test. */
export async function installAdminFixtures(page, options = {}) {
  const reads = { ...adminReadFixtures(), ...options.reads };
  return installAccessFixtures(page, { ...options, routes: async args => {
    if (args.url.origin !== args.origin) return false;
    if (await options.routes?.(args)) return true;
    const { url, method, json, scenario } = args;
    const path = url.pathname.replace(/^\/api\/v1/, '');
    if (method !== 'GET' || !Object.hasOwn(reads, path)) return false;
    if (scenario.adminError || scenario.adminFailures > 0) return false;
    const value = typeof reads[path] === 'function' ? reads[path](url) : reads[path];
    if (path === '/admin/security') {
      const status = url.searchParams.get('status');
      return json({ ...value, alerts: value.alerts.filter(row => status ? row.status === status : ['open', 'acknowledged', 'investigating'].includes(row.status)) });
    }
    if (path === '/admin/appeals' || path === '/admin/reports') {
      const key = path.endsWith('appeals') ? 'appeals' : 'reports';
      return json({ ...value, [key]: value[key].filter(row => row.status === (url.searchParams.get('status') || 'open')) });
    }
    return json(value);
  } });
}
