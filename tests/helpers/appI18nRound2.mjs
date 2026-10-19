// Fixed clock zone: the English baselines in tests/fixtures/app-round2-english-main.json are rendered in UTC, as in CI.
process.env.TZ = 'UTC';
import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
export const files = {
  developer: 'app/veyrnox/app/publish/developer/page.js', inbox: 'app/veyrnox/app/publish/inbox/page.js',
  generation: 'app/veyrnox/_components/editor/GenerationPanel.js', calendar: 'app/veyrnox/app/publish/calendar/page.js',
  oddlings: 'app/veyrnox/_components/OddlingStudio.js', editor: 'app/veyrnox/app/editor/page.js', create: 'app/veyrnox/app/create/page.js',
};
const at = '2026-10-18T12:00:00Z';
const post = { id: 'post', scheduled_at: at, status: 'scheduled', global_text: 'User caption unchanged', can_reschedule: true, targets: [{ id: 'target', network: 'tiktok', publish_status: 'delivered' }] };
export const scenarios = [
  { area: 'developer', name: 'ApiKeys', states: [[{ id: 'key', label: 'User key name', key_prefix: 'fixture', scopes: ['posts:read'], expires_at: '2099-01-01T12:00:00Z', last_used_at: at }]], key: 'app.publish.developer.endpointHelp' },
  { area: 'developer', name: 'ApiLogs', states: [[{ id: 'log', requested_at: at, api_key_label: 'User key name', method: 'GET', route: '/api/publish/v1/posts', response_status: 429, error_code: 'rate_limited' }]], key: 'app.publish.developer.logs' },
  { area: 'developer', name: 'Webhooks', states: [{ endpoints: [{ id: 'webhook', label: 'User webhook', url: 'https://example.invalid/hook', events: ['post.published'] }], deliveries: [{ id: 'delivery', endpoint_label: 'User webhook', event_type: 'post.published', outcome: 'retrying', attempted_at: at, attempts: 1234, last_status: 503 }] }], key: 'app.publish.developer.webhooksIntro' },
  { area: 'inbox', name: 'Upgrade', key: 'app.publish.inbox.planIncludes' },
  { area: 'inbox', name: 'Conversation', props: { selected: { thread: { id: 'thread', network: 'instagram', kind: 'message', participant_name: 'User name', account_name: 'User account' }, messages: [{ id: 'message', direction: 'inbound', sent_at: at, body: 'User message unchanged' }], notes: [] }, members: [], canTriage: true, canReply: false }, key: 'app.publish.inbox.triageRole' },
  { area: 'calendar', name: 'PostCard', props: { post, canWrite: true }, key: 'app.publish.calendar.delivered' },
  { area: 'calendar', name: 'CalendarControls', props: { today: '2026-10-18' }, states: ['free'], key: 'app.publish.calendar.planIncludes' },
  { area: 'generation', name: 'GenerationPanel', props: { voiceover: true }, key: 'app.editor.generation.voiceoverIntro' },
  { area: 'generation', name: 'GenerationPanel', props: { avatar: true }, key: 'app.editor.generation.avatarIntro' },
  { area: 'generation', name: 'GenerationPanel', props: { voiceover: true }, states: ['separation'], key: 'app.editor.generation.separationPolicy' },
  { area: 'oddlings', name: 'default', key: 'app.oddlings.opensCreate' },
  { area: 'editor', name: 'Editor', key: 'app.editor.legacy.policy' },
  { area: 'create', name: 'default', key: 'app.create.totalCost' },
];
export const visibleText = html => html.replace(/<[^>]*>/g, '');
export function renderScenario(scenario, locale, messages, sourceOverrides = {}) {
  const file = files[scenario.area];
  const f = fixture(locale, '/app/' + scenario.area, {
    messages, signedIn: true, sourceOverrides,
    expose: { [files.developer]: ['ApiKeys', 'ApiLogs', 'Webhooks'], [files.inbox]: ['Upgrade', 'Conversation'], [files.calendar]: ['PostCard', 'CalendarControls'], [files.editor]: ['Editor'] },
    states: scenario.states ? { [file]: scenario.states } : {},
    moduleMocks: {
      '../../_lib/useCatalog': { useCatalog: () => ({ models: scenario.catalog || [], live: true, loading: false }) },
      // The Oddling catalogs and prompts render unchanged; their network-backed
      // explore panel belongs to a later file batch.
      './OddlingExplore': { OddlingExplore: () => null, useOddlingExplore: () => ({}) },
    },
  });
  return f.render(React.createElement(f.load(file)[scenario.name], scenario.props || {}));
}
