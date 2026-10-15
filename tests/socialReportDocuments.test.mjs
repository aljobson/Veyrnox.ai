import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportDocument, buildReportPdf, buildReportPptx, reportFilename } from '../lib/social/reportDocuments.js';
import { loadSocialReportData } from '../lib/social/reportData.js';

const template = { name: 'Client / October', report_title: 'October performance', range_days: 30, compare_previous: true, include_content: true };
const analytics = { ok: true, account: { id: 'a1', network: 'instagram', display_name: 'Veyrnox' }, sync: { last_ok_at: '2026-10-14T00:00:00Z', failing: false }, evolution: [{ date: '2026-10-01', metrics: { followers: 100 } }, { date: '2026-10-14', metrics: { followers: 110 } }], posts: [{ id: 'p1', published_at: '2026-10-13T12:00:00Z', caption: 'Launch', metrics: { likes: 10, comments: 2, reach: 500 } }] };

test('report loader aggregates current and previous provider data honestly', async () => {
  const calls = [];
  const result = await loadSocialReportData({ template, authId: 'owner', brandId: 'brand', cfg: {}, now: new Date('2026-10-14T12:00:00Z'), rpcCall: async (name, args) => {
    calls.push({ name, args });
    if (name === 'list_social_accounts') return { ok: true, accounts: [{ id: 'a1', network: 'instagram', status: 'active' }] };
    return analytics;
  } });
  assert.equal(result.ok, true); assert.equal(result.current.portfolio.followers, 110); assert.equal(result.current.portfolio.reach, 500);
  assert.equal(result.current.portfolio.views, null); assert.equal(result.previous.portfolio.interactions, 12);
  assert.equal(calls.filter((call) => call.name === 'get_social_analytics').length, 2);
});

test('PDF and PowerPoint exports are valid binary containers with bounded filenames', () => {
  const data = { range: { from: '2026-09-15', to: '2026-10-14' }, current: { entries: [{ account: analytics.account, data: analytics }], portfolio: { accounts: 1, followers: 110, posts: 1, interactions: 12, reach: 500, views: null, rows: [{ account: analytics.account, summary: { followers: 110, posts: 1, interactions: 12 }, reach: 500, views: null }] } }, previous: null };
  const pdf = buildReportPdf(template, data), pptx = buildReportPptx(template, data);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 8)), '%PDF-1.4');
  assert.deepEqual([...pptx.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const pptText = new TextDecoder().decode(pptx); assert.match(pptText, /ppt\/presentation\.xml/); assert.match(pptText, /October performance/);
  assert.equal(reportFilename(template, 'pdf'), 'Client-October.pdf');
  assert.equal(buildReportDocument(template, data, 'pptx').contentType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});
