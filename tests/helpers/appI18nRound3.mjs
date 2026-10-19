import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
export const files = {
  media: 'app/veyrnox/_components/editor/AdvancedMediaBin.js',
  project: 'app/veyrnox/app/projects/[id]/page.js',
  person: 'app/veyrnox/_components/editor/PersonProcessingControls.js',
  projects: 'app/veyrnox/app/projects/page.js',
  ads: 'app/veyrnox/app/publish/ads/page.js',
  projectBar: 'app/veyrnox/_components/editor/ProjectBar.js',
  reports: 'app/veyrnox/app/publish/reports/page.js',
  billing: 'app/veyrnox/_components/CreditSubscriptions.js',
  video: 'app/veyrnox/app/video-agent/page.js',
};
const at = '2026-10-18T12:00:00Z';
const document = { schema_version: 1, project_id: 'project', brief: 'User brief unchanged', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
const media = { id: 'media', name: 'User media unchanged', kind: 'video', frames: 90, hasAudio: false, folder: '', tags: [] };
const plan = { id: 'starter-monthly', billing_interval: 'month', credits: 1200, price_usd_cents: 1000 };
const catalog = { consent_version: 'test-consent', plans: [plan] };
export const scenarios = [
  { area: 'media', name: 'AdvancedMediaBin', props: { tl: { media: { media } }, blobs: { current: new Map() }, loaded: [], proxies: new Set() }, key: 'app.editor.media.libraryContents' },
  { area: 'media', name: 'MediaArtwork', props: { media, blobs: { current: new Map() } } },
  { area: 'project', name: 'DocumentEditor', props: { id: 'project' }, states: [{ name: 'User project unchanged' }, document, document, 2, [{ revision: 2, created_at: at, restored_from: 1 }], 'cursor', false, false, '', false, { document, revision: 3 }, { document, revision: 1, created_at: at }, '', false, at, ''] },
  { area: 'projects', name: 'default', states: [[{ id: 'workspace', name: 'User workspace unchanged' }], 'workspace', [{ id: 'project', name: 'User project unchanged', created_at: at }], false] },
  { area: 'projects', name: 'ProjectDialog', props: { mode: 'create', workspace: 'workspace' } },
  { area: 'projects', name: 'ProjectDialog', props: { mode: 'delete', project: { name: 'User project unchanged', version: 1 } } },
  ...['replace-background', 'skin-retouch', 'person-light', 'person-reshape', 'person-reframe'].map(tool => ({ area: 'person', name: 'PersonProcessingControls', states: [tool], props: { media, timeline: {}, blob: null } })),
  { area: 'ads', name: 'AdsWorkspace', states: [[{ id: 'campaign', name: 'User campaign unchanged', network: 'tiktok', mode: 'standalone', objective: 'awareness', currency: 'GBP', daily_budget_cents: 123456 }], [], 'owner'] },
  { area: 'projectBar', name: 'ProjectSessionBar', props: { tl: { media: {}, video: [], audio: [], text: [] }, blobs: { current: new Map() } }, states: [null, 'project', 'User project unchanged', null, 2, at, false, '', null, { library: [], local: [] }, false, { projects: [], workspace: 'workspace', newName: '' }, [{ revision: 1, created_at: at, restored_from: 2, actor_id: 'test-user' }]] },
  { area: 'reports', name: 'ReportTemplates', states: [[], [{ id: 'report', name: 'User report unchanged', range_days: 30, compare_previous: true, include_content: true, accent_color: '#38bdf8', delivery_cadence: 'weekly', delivery_recipients: ['fixture@example.invalid'], delivery_format: 'pdf', next_delivery_at: at, last_delivery_status: 'ready' }], 'owner', true, true, true] },
  { area: 'billing', name: 'Billing', props: { account: 'test-user' }, states: [catalog, null, false, true, plan.id] },
  { area: 'billing', name: 'Billing', props: { account: 'test-user' }, states: [catalog, { ...plan, plan_id: plan.id, status: 'active', current_period_end: at, cancel_at_period_end: false }, false, true, '', false, false, '', '', 'cooling_off'] },
  { area: 'video', name: 'default' },
  { area: 'video', name: 'default', states: [100, false, 'User brief unchanged', '9:16', { credits: 165, expires_at: 4102444800, plan: { summary: 'Provider summary unchanged', seconds: 10 }, aspect: '9:16', brief: 'User brief unchanged', narrationText: 'User narration unchanged' }, false, null, 'User narration unchanged'] },
];
export const visibleText = html => html.replace(/<[^>]*>/g, '');
export function renderScenario(scenario, locale, messages, sourceOverrides = {}) {
  const file = files[scenario.area];
  const f = fixture(locale, '/app/' + scenario.area, {
    messages, signedIn: true, sourceOverrides,
    expose: { [files.project]: ['DocumentEditor'], [files.projects]: ['ProjectDialog'], [files.ads]: ['AdsWorkspace'], [files.projectBar]: ['ProjectSessionBar'], [files.reports]: ['ReportTemplates'], [files.billing]: ['Billing'] },
    states: scenario.states ? { [file]: scenario.states } : {},
    moduleMocks: {
      '../ProjectsFlag': { useProjectsEnabled: () => true }, '../../_components/ProjectsFlag': { useProjectsEnabled: () => true },
      './CompletionFlags': { useEditorCompletionFlags: () => ({ organization: false }) },
      './MultitrackFlag': { useMultitrackEnabled: () => true },
      // Child UI is inventoried separately; these tests exercise this round's files.
      './MediaDetails': { MediaDetails: () => null }, './LibraryGrid': { LibraryGrid: () => null }, './FolderControls': { FolderControls: () => null },
      './ReportScheduleFields': { ReportScheduleFields: () => null },
      '../../_lib/useStudioJobs': { useStudioJobs: () => ({ jobs: [], startJobs() {}, generating: false }) },
    },
  });
  return f.render(React.createElement(f.load(file)[scenario.name], scenario.props || {}));
}
